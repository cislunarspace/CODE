//! 协议解析器对真实 sidecar 输出的夹具测试（#522 修复前经 exclude_unset 复刻生成）。

use cislunar_code_lib::sidecar::{FrameArray, ProtocolEvent, StreamParser};

fn load_fixture(name: &str) -> Vec<u8> {
    let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).unwrap_or_else(|e| panic!("读取夹具 {path} 失败：{e}"))
}

#[test]
fn family_ok_f32_stream_parses_end_to_end() {
    let raw = load_fixture("family_ok_f32.bin");
    let mut parser = StreamParser::new();
    let events = parser.push(&raw).unwrap();
    parser.finish().unwrap();

    // 事件序：progress 行 → ok 信封行 → 3 帧
    assert_eq!(events.len(), 5);
    match &events[0] {
        ProtocolEvent::Line(v) => {
            assert_eq!(v["status"], "progress");
            assert_eq!(v["meta"]["job_id"], "j1");
        }
        _ => panic!("首事件应为 progress 行"),
    }
    let (status, n_frames) = match &events[1] {
        ProtocolEvent::Line(v) => {
            assert_eq!(v["binary_frames"], 3);
            (v["status"].as_str().unwrap(), v["binary_frames"].as_u64().unwrap())
        }
        _ => panic!("第二事件应为 ok 信封行"),
    };
    assert_eq!(status, "ok");
    assert_eq!(n_frames, 3);

    for ev in &events[2..] {
        let arr = match ev {
            ProtocolEvent::Frame(a) => a,
            _ => panic!("信封后应为帧"),
        };
        assert_eq!(arr.shape(), &[1, 6]);
        match arr {
            FrameArray::F32 { data, .. } => assert_eq!(data.len(), 6),
            _ => panic!("夹具声明 f32"),
        }
    }
}

#[test]
fn family_f32_values_match_python_reference() {
    // 夹具首帧首点来自 e2m2e 侧参考输出（f32 精度）
    let raw = load_fixture("family_ok_f32.bin");
    let mut parser = StreamParser::new();
    let events = parser.push(&raw).unwrap();
    match &events[2] {
        ProtocolEvent::Frame(FrameArray::F32 { data, .. }) => {
            assert!((data[0] - 0.854_806_07).abs() < 1e-6, "首帧 x0 = {}", data[0]);
        }
        _ => panic!("应为 f32 帧"),
    }
}

#[test]
fn unknown_tool_error_envelope_parses() {
    let raw = load_fixture("unknown_tool.bin");
    let mut parser = StreamParser::new();
    let events = parser.push(&raw).unwrap();
    parser.finish().unwrap();
    assert_eq!(events.len(), 1);
    match &events[0] {
        ProtocolEvent::Line(v) => {
            assert_eq!(v["status"], "error");
            assert_eq!(v["error"]["code"], "UNKNOWN_TOOL");
        }
        _ => panic!("应为错误信封行"),
    }
}