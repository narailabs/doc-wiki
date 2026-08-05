# Class Hierarchy

This page documents the small `Animal` hierarchy used in the sample app's
domain layer. The hierarchy demonstrates simple single inheritance with
polymorphic methods.

## Classes

- `Animal` is the abstract base.
- `Dog` and `Cat` are concrete subclasses.

## Diagram

<!-- wiki-mermaid: start -->
<!-- wiki-mermaid: end -->

## Notes

- The hierarchy is intentionally shallow; deeper trees are flagged by the
  domain-modeling lint as a code smell.
