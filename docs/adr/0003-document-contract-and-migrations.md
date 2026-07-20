# ADR 0003: Treat the document format as a tested contract

- Status: Accepted
- Date: 2026-07-20

## Context

Envelope handling, legacy attribute migration, automatic IDs, and cross-reference synchronization previously existed in both TypeScript and Rust. The implementations had already diverged in duplicate-ID handling and numbering behavior.

## Decision

Treat `sdoc.schema.json` and shared TypeScript types as the documented contract. Protect behavior with common JSON fixtures and unit tests. The TypeScript document core is the only implementation of semantic migration and normalization. Rust preserves the JSON document value while transporting the envelope and verifies that behavior against the same fixture.

## Consequences

Format changes require schema, migration, fixture, and converter updates. Backward compatibility becomes deliberate and testable, and the two hosts cannot silently acquire different document semantics.
