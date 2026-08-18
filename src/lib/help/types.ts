/**
 * The shape of one help topic.
 *
 * A topic explains a page of the app end to end: what it answers, what it looks
 * like, and the SQL it fires. The SQL is stored as ordered steps rather than one
 * blob so the rendered code block and the explanations cannot drift apart — the
 * block *is* the steps, joined.
 *
 * The picture of the page is a small live mock rather than a screenshot: a
 * screenshot needs a connected database to capture and goes stale the day the UI
 * moves. The mock also lets a clause of SQL highlight the pixels it produced,
 * which an image cannot do.
 */

/** One clause of the statement, with the plain-English reading of it. */
export interface SqlStep {
  /** Stable id. A mock element marked with the same id lights up with it. */
  id: string
  /** The SQL exactly as it is sent, this fragment only. */
  clause: string
  /** Short label for the clause: "Only this database". */
  title: string
  /** Beginner-level explanation. Assume no Postgres background. */
  detail: string
}

/** Where the statement lives in this repo, so the doc can be checked against it. */
export interface HelpSource {
  file: string
  line: number
  /** A distinctive line of the real SQL, asserted to still be in that file. */
  anchor: string
}

export interface HelpTerm {
  term: string
  meaning: string
}

export interface HelpTopic {
  /** URL segment: /help/query-board. */
  id: string
  title: string
  /** The question the page answers, in the reader's words. */
  question: string
  /** Heading this topic sits under in the contents. Order follows the registry. */
  section: string
  /** Two or three sentences of answer, before any SQL. */
  answer: string
  /** The route this topic documents, for the "open the real page" link. */
  route: string
  /** One line under the mock, saying what the mock is showing. */
  previewCaption: string
  source: HelpSource
  /** Anything the statement needs before it runs — an extension, a version. */
  prerequisite: string | null
  steps: SqlStep[]
  terms: HelpTerm[]
  /** What it costs to run: what it reads, when it gets slow. */
  cost: string
}

/** The statement as it is sent, rebuilt from the steps that explain it. */
export function topicSql(topic: HelpTopic): string {
  return topic.steps.map((step) => step.clause).join('\n')
}
