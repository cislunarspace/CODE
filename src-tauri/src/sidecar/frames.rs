//! 帧与协议流解析实现（见 process.rs 的模块说明与 e2m2e ADR 0035）。

use std::fmt;

pub const MAGIC: u32 = 0x324D_3245;

#[derive(Debug)]
pub enum ProtocolError {
    /// 帧头/shape/数据段不完整。
    Truncated(&'static str),
    /// magic 或 dtype 码非法。
    BadFrame(String),
    /// 信封行不是合法 JSON 或不含换行符。
    BadLine(String),
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProtocolError::Truncated(what) => write!(f, "协议流截断：{what}"),
            ProtocolError::BadFrame(msg) => write!(f, "帧格式非法：{msg}"),
            ProtocolError::BadLine(msg) => write!(f, "信封行非法：{msg}"),
        }
    }
}

impl std::error::Error for ProtocolError {}

/// 一个解码出的二进制帧数组（f32 或 f64，附带 shape）。
#[derive(Debug, Clone, PartialEq)]
pub enum FrameArray {
    F32 { shape: Vec<u32>, data: Vec<f32> },
    F64 { shape: Vec<u32>, data: Vec<f64> },
}

impl FrameArray {
    pub fn shape(&self) -> &[u32] {
        match self {
            FrameArray::F32 { shape, .. } | FrameArray::F64 { shape, .. } => shape,
        }
    }

    pub fn len(&self) -> usize {
        match self {
            FrameArray::F32 { data, .. } => data.len(),
            FrameArray::F64 { data, .. } => data.len(),
        }
    }
}

/// 从 `buf` 开头解码一帧，返回 (数组, 消费字节数)。
pub fn decode_frame(buf: &[u8]) -> Result<(FrameArray, usize), ProtocolError> {
    if buf.len() < 6 {
        return Err(ProtocolError::Truncated("帧头不足 6 字节"));
    }
    let magic = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]);
    if magic != MAGIC {
        return Err(ProtocolError::BadFrame(format!(
            "magic 不符：0x{magic:08X}（期望 0x{MAGIC:08X}）"
        )));
    }
    let dtype_code = buf[4];
    let f64_flag = match dtype_code {
        0 => false,
        1 => true,
        other => {
            return Err(ProtocolError::BadFrame(format!("未知 dtype 码 {other}（支持：0=f32，1=f64）")))
        }
    };
    let ndim = buf[5] as usize;
    if ndim < 1 {
        return Err(ProtocolError::BadFrame(format!("ndim 必须 ≥ 1，帧内为 {ndim}")));
    }
    let shape_end = 6 + 4 * ndim;
    if buf.len() < shape_end {
        return Err(ProtocolError::Truncated("shape 段不完整"));
    }
    let mut shape = Vec::with_capacity(ndim);
    let mut n_elements: u64 = 1;
    for i in 0..ndim {
        let o = 6 + 4 * i;
        let dim = u32::from_le_bytes([buf[o], buf[o + 1], buf[o + 2], buf[o + 3]]);
        shape.push(dim);
        n_elements = n_elements.saturating_mul(dim as u64);
    }
    let item_size = if f64_flag { 8 } else { 4 };
    let data_len = (n_elements as usize) * item_size;
    let data_end = shape_end + data_len;
    if buf.len() < data_end {
        return Err(ProtocolError::Truncated("数据段不完整"));
    }
    let bytes = &buf[shape_end..data_end];
    let arr = if f64_flag {
        let mut data = Vec::with_capacity(n_elements as usize);
        for chunk in bytes.chunks_exact(8) {
            data.push(f64::from_le_bytes(chunk.try_into().unwrap()));
        }
        FrameArray::F64 { shape, data }
    } else {
        let mut data = Vec::with_capacity(n_elements as usize);
        for chunk in bytes.chunks_exact(4) {
            data.push(f32::from_le_bytes(chunk.try_into().unwrap()));
        }
        FrameArray::F32 { shape, data }
    };
    Ok((arr, data_end))
}

/// 协议流事件：信封 JSON 行或二进制帧。
#[derive(Debug, Clone, PartialEq)]
pub enum ProtocolEvent {
    /// 信封行（原始 JSON 值；progress 行与最终响应都是它）。
    Line(serde_json::Value),
    Frame(FrameArray),
}

/// 增量解析器：喂入任意切分的字节流，吐出完整事件。
///
/// 用法：`push` 返回 0..n 个事件，缓冲不足时内部留存，不报错；
/// 流结束时调用 [`StreamParser::finish`] 校验没有悬挂的半行/半帧。
pub struct StreamParser {
    buf: Vec<u8>,
    /// 剩余待读的帧数（由信封行 binary_frames 声明）。
    pending_frames: u32,
    scanned: usize,
}

impl Default for StreamParser {
    fn default() -> Self {
        Self::new()
    }
}

impl StreamParser {
    pub fn new() -> Self {
        Self { buf: Vec::new(), pending_frames: 0, scanned: 0 }
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<ProtocolEvent>, ProtocolError> {
        self.buf.extend_from_slice(chunk);
        let mut events = Vec::new();
        loop {
            if self.pending_frames > 0 {
                match decode_frame(&self.buf[self.scanned..]) {
                    Ok((arr, used)) => {
                        self.scanned += used;
                        self.pending_frames -= 1;
                        events.push(ProtocolEvent::Frame(arr));
                    }
                    Err(ProtocolError::Truncated(_)) => break,
                    Err(e) => {
                        // 坏帧（magic/dtype/长度非法）无法恢复：上抛给读循环，
                        // 由它唤醒等待者并终止（调用方重建 sidecar）
                        return Err(e);
                    }
                }
                continue;
            }
            let nl = match self.buf[self.scanned..].iter().position(|&b| b == b'\n') {
                Some(i) => self.scanned + i,
                None => break,
            };
            let line = &self.buf[self.scanned..nl];
            self.scanned = nl + 1;
            if line.is_empty() {
                continue;
            }
            let value: serde_json::Value = match serde_json::from_slice(line) {
                Ok(v) => v,
                Err(e) => {
                    let ev = ProtocolEvent::Line(serde_json::json!({
                        "status": "error",
                        "data": null,
                        "error": {"code": "BAD_LINE", "message": e.to_string()},
                        "meta": {},
                    }));
                    events.push(ev);
                    continue;
                }
            };
            if let Some(n) = value.get("binary_frames").and_then(|v| v.as_u64()) {
                self.pending_frames = n as u32;
            }
            events.push(ProtocolEvent::Line(value));
        }
        // 回收已消费前缀，控制内存
        if self.scanned > 0 {
            self.buf.drain(..self.scanned);
            self.scanned = 0;
        }
        Ok(events)
    }

    pub fn finish(&self) -> Result<(), ProtocolError> {
        if self.pending_frames > 0 || self.scanned < self.buf.len() {
            Err(ProtocolError::Truncated("流在半行/半帧处结束"))
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造一帧（测试辅助，字段布局与文档一致）。
    fn make_frame(dtype: u8, shape: &[u32], f32s: &[f32], f64s: &[f64]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&MAGIC.to_le_bytes());
        out.push(dtype);
        out.push(shape.len() as u8);
        for d in shape {
            out.extend_from_slice(&d.to_le_bytes());
        }
        if dtype == 0 {
            for v in f32s {
                out.extend_from_slice(&v.to_le_bytes());
            }
        } else {
            for v in f64s {
                out.extend_from_slice(&v.to_le_bytes());
            }
        }
        out
    }

    #[test]
    fn decode_f32_frame() {
        let frame = make_frame(0, &[1, 6], &[0.85, 0.0, 0.001, 0.0, -0.13, 0.0], &[]);
        let (arr, used) = decode_frame(&frame).unwrap();
        assert_eq!(used, frame.len());
        assert_eq!(arr.shape(), &[1, 6]);
        match arr {
            FrameArray::F32 { data, .. } => assert!((data[0] - 0.85).abs() < 1e-6),
            _ => panic!("应为 f32"),
        }
    }

    #[test]
    fn decode_f64_frame() {
        let frame = make_frame(1, &[3], &[], &[1.5, -2.5, 3.25]);
        let (arr, used) = decode_frame(&frame).unwrap();
        assert_eq!(used, frame.len());
        match arr {
            FrameArray::F64 { data, .. } => {
                for (g, w) in data.iter().zip([1.5, -2.5, 3.25]) {
                    assert!((g - w).abs() < 1e-6);
                }
            }
            _ => panic!("应为 f64"),
        }
    }

    #[test]
    fn reject_bad_magic_and_dtype() {
        let mut frame = make_frame(0, &[1], &[1.0], &[]);
        frame[3] ^= 0xFF; // 破坏 magic
        assert!(matches!(decode_frame(&frame), Err(ProtocolError::BadFrame(_))));
        let mut frame = make_frame(0, &[1], &[1.0], &[]);
        frame[4] = 7; // 未知 dtype 码
        assert!(matches!(decode_frame(&frame), Err(ProtocolError::BadFrame(_))));
    }

    #[test]
    fn reject_truncated() {
        let frame = make_frame(0, &[2, 2], &[1.0; 4], &[]);
        for cut in [1usize, 5, 9, 14, 20] {
            assert!(matches!(decode_frame(&frame[..cut]), Err(ProtocolError::Truncated(_))));
        }
    }

    #[test]
    fn parser_handles_split_chunks() {
        let line = br#"{"status":"ok","binary_frames":1}"#;
        let frame = make_frame(0, &[1, 6], &[0.0; 6], &[]);
        let mut stream = Vec::new();
        stream.extend_from_slice(line);
        stream.push(b'\n');
        stream.extend_from_slice(&frame);
        stream.extend_from_slice(b"{\"status\":\"done\"}\n");

        let mut parser = StreamParser::new();
        // 逐字节喂入，模拟任意切分
        let mut events = Vec::new();
        for b in &stream {
            events.extend(parser.push(&[*b]).unwrap());
        }
        parser.finish().unwrap();
        assert_eq!(events.len(), 3);
        assert!(matches!(&events[0], ProtocolEvent::Line(v) if v["status"] == "ok"));
        assert!(matches!(&events[1], ProtocolEvent::Frame(a) if a.shape() == &[1, 6]));
        assert!(matches!(&events[2], ProtocolEvent::Line(v) if v["status"] == "done"));
    }

    #[test]
    fn parser_returns_err_on_bad_frame() {
        let mut bad = Vec::new();
        bad.extend_from_slice(br#"{"status":"ok","binary_frames":1}
"#);
        let mut frame = make_frame(0, &[1], &[1.0], &[]);
        frame[3] ^= 0xFF; // 破坏 magic
        bad.extend_from_slice(&frame);
        let mut parser = StreamParser::new();
        let first = parser.push(&bad);
        // 一次性喂入时信封行与坏帧同批，直接 BadFrame（事件丢弃是可接受的：
        // 读循环对 Err 的处置是终止并重建，不消费部分事件）
        assert!(matches!(first, Err(ProtocolError::BadFrame(_))));
    }

    #[test]
    fn parser_finish_rejects_hanging_stream() {
        let mut parser = StreamParser::new();
        parser.push(b"{\"binary_frames\":2}\n").unwrap();
        parser.push(&make_frame(0, &[1], &[1.0], &[])).unwrap();
        assert!(parser.finish().is_err());
    }
}