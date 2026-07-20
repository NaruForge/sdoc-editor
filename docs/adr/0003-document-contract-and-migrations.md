# ADR 0003: Treat the document format as a tested contract

- Status: Accepted
- Date: 2026-07-20

## Context

Envelope handling, legacy attribute migration, automatic IDs, and cross-reference synchronization exist in TypeScript and Rust. Unchecked changes can make the two hosts interpret the same file differently.

## Decision

Treat `sdoc.schema.json` and shared TypeScript types as the documented contract. Protect behavior with common JSON fixtures and unit tests. Rust may implement the behavior natively but must pass equivalent contract fixtures.

## Consequences

Format changes require schema, migration, fixture, and converter updates. Backward compatibility becomes deliberate and testable.
