# Coding standards

The `code-reviewer` agent reads this file on its standards axis. The implementer doesn't: it makes the code work, and
review makes it good.

Keep only **judgement calls** here. A rule a tool can check (a banned import, a file location, a formatting choice)
belongs in a linter rule, a hook or a CI job, where it costs nothing to enforce. `/retro` sorts new rules into the
right place.

There is no stack pack for this repo (see `docs/agents/stack.md`), so there is no pack review checklist; the
per-language sections below stand in for one. The reviewer also applies `GLOSSARY.md`: a word the glossary lists under
_Avoid_, in code, UI text or tests, is a violation.

## Names come from the glossary

Types, functions, tests, UI labels and log messages use the glossary's terms. When no term fits, that is a gap to settle
with `/grill-with-docs`, not a name to invent in the code.

## Comments say why

Code shows what it does. A comment earns its place by explaining a reason the code can't show. When that reason is a
decision someone might reverse, it belongs in an ADR, and the comment points at it.

## Tests go through the front door

Tests exercise the module through its public interface, at the seams agreed for the ticket, and set up their data
through the same interface. When a test needs a setup function that doesn't exist, add it to the module rather than
writing rows or fields directly.

## Failures are visible

Nothing is swallowed. An error at a boundary becomes a clear, typed response for the caller, and the original cause is
kept.

## Every service: the gRPC boundary

- **The contract is `protos/demo.proto`.** A change to it is a change to every service that uses that message:
  regenerate each one's code with its `genproto.sh` in the same PR, and add fields rather than renumbering or reusing
  them, so a service not yet redeployed still understands the message.
- **Every outgoing call has a deadline.** A call without one waits as long as the caller does; one slow service then
  holds every request upstream of it.
- **Errors cross the boundary as gRPC status codes that mean something.** `InvalidArgument` for bad input,
  `NotFound`, `FailedPrecondition`, `Unavailable` for a dependency that's down; `Internal` only for a real bug.
  The message is for a person; the cause stays in this service's log.
- **Money is `Money` (units + nanos + currency code), never a float.** Add, multiply and convert through each
  service's money helpers, and never add amounts in different currencies.

## Go

- Wrap errors with context (`fmt.Errorf("quote shipping: %w", err)`) so the cause survives; compare with `errors.Is`
  or `errors.As`, not by message.
- Pass the request's `context.Context` through every call that can block; don't start from `context.Background()`
  inside a handler.
- Pass protobuf messages by pointer (`*pb.Money`). Copying one copies its internal lock (issue #7).

## C# (cartservice)

- Async all the way: `await` I/O, never `.Result` or `.Wait()`, and pass the `CancellationToken` gRPC hands you.
- A cart store failure becomes an `RpcException` with a fitting status, not an empty cart.

## Java (adservice)

- Close or complete every `StreamObserver` exactly once, on the error path too (`onError` with a `Status`).
- Logs go through the existing logger with parameters, not string concatenation.

## Node (currencyservice, paymentservice)

- A handler answers its callback exactly once, error or result; an exception thrown inside an async callback otherwise
  never reaches the caller.
- Validate input at the handler (card number, expiry, amounts) and answer with a clear status; don't let a library
  throw it for you.

## Python (email, recommendation, shopping assistant, load generator)

- Catch exceptions only where they can be answered, and answer with `context.abort(code, message)`, not a silent
  empty reply.
- Configuration (ports, service addresses, keys) comes from the environment, read once at startup; no secrets in code.
