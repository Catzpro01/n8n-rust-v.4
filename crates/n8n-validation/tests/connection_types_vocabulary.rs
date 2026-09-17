//! Falsifiability guard for the shared n8n 2.9.4 connection vocabulary.
//!
//! The exact ordered list is deliberate: removing or renaming any one canonical
//! entry makes this test fail instead of allowing silent validator drift.

use n8n_validation::NODE_CONNECTION_TYPES;

const REFERENCE_NODE_CONNECTION_TYPES: [&str; 13] = [
    "ai_agent",
    "ai_chain",
    "ai_document",
    "ai_embedding",
    "ai_languageModel",
    "ai_memory",
    "ai_outputParser",
    "ai_retriever",
    "ai_reranker",
    "ai_textSplitter",
    "ai_tool",
    "ai_vectorStore",
    "main",
];

#[test]
fn canonical_vocabulary_matches_n8n_294_exactly() {
    assert_eq!(NODE_CONNECTION_TYPES, REFERENCE_NODE_CONNECTION_TYPES);
    assert_eq!(NODE_CONNECTION_TYPES.len(), 13);
    for connection_type in REFERENCE_NODE_CONNECTION_TYPES {
        assert!(
            NODE_CONNECTION_TYPES.contains(&connection_type),
            "canonical type must be present: {connection_type}"
        );
    }
}

#[test]
fn values_outside_the_canonical_vocabulary_are_rejected() {
    for connection_type in ["", "unknown", "AI_AGENT", "ai_output_parser"] {
        assert!(
            !NODE_CONNECTION_TYPES.contains(&connection_type),
            "non-reference type must be rejected: {connection_type}"
        );
    }
}
