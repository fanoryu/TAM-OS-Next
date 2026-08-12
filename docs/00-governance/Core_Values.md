# Core Values

Four values resolve the judgement calls that rules cannot fully specify. When two reasonable
approaches remain after the Constitution has been applied, these values decide.

## Clarity over Cleverness
Readable, boring code that matches the surrounding style beats a clever abstraction. The next
engineer — human or AI — should understand a change without archaeology. Clarity is measured by how
quickly a stranger can be certain the code is correct, not by how compact it is.

## Evidence over Assumption
Claims are backed by the verifier, by runtime checks against fabricated data, and by observed
behavior in both artifacts. "It should work" is not a status. If a step was skipped or a test
failed, that is reported plainly with the output — never smoothed over.

## Discipline over Speed
Scope holds. One PR expresses one purpose; invariants are preserved; approval gates are respected.
A slower change that keeps the system trustworthy is always cheaper than a fast change that erodes
confidence in the stored data.

## Evolution over Revolution
The architecture advances in small, reversible, well-understood steps. We extend behind existing
data shapes, extract only what is already duplicated, and supersede decisions rather than rewrite
history. We do not rebuild what works to chase novelty.

## Knowledge over Memory
Important decisions live in the repository, not in anyone's head or a chat log. Institutional knowledge
must not depend on conversation history that can be lost, and engineering context must survive changes
in people, tools, and AI assistants. When recollection and the record disagree, the documented evidence
takes precedence. This value is the daily expression of Law XII — *Documentation Is Executable
Knowledge* — and Law X — *No Knowledge Loss*.

---

*Values guide; they do not override the invariants in the [Engineering Constitution](Engineering_Constitution.md).
Where a value and a **MUST** rule conflict, the rule wins and the conflict is surfaced.*
