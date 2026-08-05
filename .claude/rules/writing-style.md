---
paths: ["**/*.md", "**/*.mdx", "docs/**", "**/README*"]
source: ~/.claude/skills/plain-writing/SKILL.md
---

# Writing style for prose

Write prose that a reader understands on the first read. This applies to any prose a person outside our
own tooling will read. It covers pull request and commit descriptions, docs, README files, public specs,
and architecture proposals. It does not apply to code itself, only to the words around it.

This is the full house style, taken from the `plain-writing` skill. When you draft or revise this kind of
prose, apply the `plain-writing` skill, or follow every rule below.

## The rules

1. **Use simple, everyday words.** Prefer the common word over the fancy one, e.g., write "use" rather
   than "leverage". Short familiar words are faster to read. Avoid the words AI tools overuse, e.g.,
   "delve", "tapestry", "landscape", "robust", and "leverage". Also, repeat a word rather than swapping
   in a synonym just to avoid repeating it.

2. **Write complete sentences.** Each sentence states one clear thing and has a subject and a verb. Do
   not write fragments, and do not stitch several ideas together with colons or semicolons into one dense
   line. If a sentence states two things, split it into two sentences.

3. **No dashes, and limit colons.** Do not use em dashes or en dashes, including in number ranges. Join
   clauses with a period, or with a word such as "and". Write ranges with the word "to", e.g., "0.94 to
   0.96". Use a colon only to introduce a list. Do not use a colon to join clauses or to set up a point,
   e.g., "Read for the schema: the feature fires". Dashes, and colons used for a point, invite the clever
   phrasing the user does not want. Use straight quotes, not curly quotes, e.g., "the agent" rather than
   the curly-quote version.

4. **No jargon.** Do not use shorthand from a field when a plain phrase works. If a technical term is
   truly needed, say it once and explain it in plain words. Avoid a word such as "calibrated" unless you
   define it simply.

5. **No analogies or imagery.** Do not explain something by comparing it to a different thing. Do not use
   a metaphor or any phrase meant to sound smart. Describe the actual thing in literal terms. Avoid the
   "not just X, it is Y" pattern, e.g., "it is not just a parser, it is a toolchain". State what the
   thing is.

6. **No filler.** Cut words and phrases that add nothing, e.g., "it is worth noting that". Every sentence
   should add something the reader needs. Watch for an "-ing" tail that adds fake analysis, e.g., "stores
   results, highlighting its value". Cut it, or say the plain reason.

7. **Explain things fully and clearly.** Plain also does not mean terse. If an idea is compressed into
   one cramped sentence, expand it so each point gets its own sentence and the reader can follow it. When
   you have several distinct things to list, give each one a clear sentence or its own bullet, not one
   long line. Clarity comes before both shortness and length.

8. **Do not make an inanimate thing do an action it cannot do.** An inanimate subject should usually only
   take "is" or "are", not an action verb, e.g., do not write "logs become searchable records". Make a
   person the actor instead, e.g., "you can search the logs". An exception to this is a common phrase
   like "the paper argues".

9. **Do not invent hyphenated adjectives.** A common compound adjective that people already use is fine,
   e.g., "well-crafted". Avoid a phrase you make up by joining words with a hyphen to sound compact or
   clever, e.g., "reveal-style colon". When you catch yourself coining one, reword it in plain words. A
   good test is whether you would find the term in a dictionary or hear it in normal speech. If not,
   write it out.

10. **Do not pad with empty emphasis or puffery words.** Words like "really" and "real" add emphasis but
    no information, so drop them. Do not say that something "matters" or "carries weight". Do not puff
    something up with words like "boasts", "a testament to", "pivotal", or "renowned". State the actual
    point, or cut the sentence.

11. **Keep lists and examples simple.**
    - Do not write a three-part series in a sentence, e.g., "it is simple, clear, and direct". It sounds
      practiced. When you have items to list, use a bullet list. Do not pad a list to three just for
      rhythm.
    - When you use an example to make a point, give one example and introduce it with "e.g.". Do not
      stack several examples for the same point.

12. **Do not attribute a claim to no one.** Do not hide a claim behind a vague source, e.g., "experts
    say" or "studies show". Name the source, or cut the claim.

13. **Keep the formatting plain.** Use sentence case in a heading, e.g., "How to install the skill", not
    "How To Install The Skill". Do not use boldface as decoration, such as bolding the first phrase of
    every bullet.

## How to revise

Revise in two passes.

First pass. Read the text once and fix anything that breaks the rules above.

Second pass. Read the result again as if you had never seen it. Go clause by clause and ask whether each
clause adds something the reader needs. If a clause or a whole sentence does not earn its place, remove
it. Then check that a reader seeing the text for the first time would understand every sentence.

When you use the `plain-writing` skill interactively and the second pass changes anything, the skill also
writes a small HTML file that shows the before and after and the reason for each change.

## Examples

These are before and after pairs.

**Example 1. Dashes and jargon.**
Before: Fresh-annotation re-scoring (cache bypassed) moved means by less than 0.004. Read for the schema:
"feature fires" is a calibrated proxy for "the property holds" at F1 of 0.94 to 0.96 for coherent
features.
After: We ran the scoring again with new language model calls and no caching. The average scores changed
by less than 0.004, so they are not an effect of caching. For most features, the description agrees with
how the feature actually behaves, at an F1 of about 0.94 to 0.96.

**Example 2. Filler.**
Before: It is worth noting that the second pass actually removes quite a lot of words, and this matters.
After: The second pass removes a lot of words.

**Example 3. One cramped sentence split into clear ones.**
Before: The groups the features were sorted into were the authors' own reading, the example posts were
written by hand, and finer detail meant training extra small models and labeling again.
After: First, the authors sorted the features into groups themselves, based on their own reading of the
results. Second, they wrote the example posts by hand after reading many of the posts. Third, when they
wanted finer detail, they trained another small model and labeled the posts again.

**Example 4. Analogy removed.**
Before: The feature index is like a card catalog that the optimizer can flip through.
After: The feature index is a list of named features. The optimizer can look up which feature matches a
request.

**Example 5. An inanimate thing doing an action it cannot do.**
Before: The logs become searchable records once the job finishes.
After: You can search the logs once the job finishes.

**Example 6. A group of three.**
Before: Configuring things is usually messy: random files, infinite pickers, and knobs you didn't even
know existed.
After: Configuring things is usually messy, e.g., the settings are scattered across many files.

**Example 7. Empty importance words.**
Before: This result matters, and it carries weight for the design.
After: As a result, the system can skip the model on most documents.

**Example 8. Puffery.**
Before: This release stands as a testament to the team and plays a pivotal role in parsing.
After: We added streaming in this release, and other teams now use it.

**Example 9. An "-ing" tail that adds fake analysis.**
Before: The cache stores results, highlighting its value for speed.
After: The cache stores results, so repeated queries are faster.

**Example 10. Negative parallelism.**
Before: It is not just a parser, it is a full toolchain.
After: It is a parser and a formatter.

**Example 11. Vague attribution.**
Before: Experts say this approach scales well.
After: In our benchmark, this approach handled a million rows.

**Example 12. Elegant variation.**
Before: Upload the document. The file is parsed, and the record is saved.
After: Upload the document. The document is parsed and saved.
