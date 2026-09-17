//! `n8n-workflow-compat` — differential compatibility runner.
//!
//! Reads a workflow fixture (same schema as `tests/compatibility/fixtures/`)
//! and prints one line per query:  `<query>\t<canonical-json-result>`
//!
//! The output is meant to be `diff`ed against the Node.js reference harness
//! output (original n8n functions) — see `tests/compatibility/run.sh`.

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 2 {
        eprintln!("usage: n8n-workflow-compat <fixture.json>");
        std::process::exit(2);
    }
    let path = &args[1];
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("error: cannot read {path}: {e}");
            std::process::exit(1);
        }
    };
    match n8n_workflow::compat_engine::run_fixture(&text) {
        Ok(out) => print!("{out}"),
        Err(e) => {
            eprintln!("error: {e}");
            std::process::exit(1);
        }
    }
}
