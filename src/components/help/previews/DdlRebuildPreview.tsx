import { Marked } from '#/components/help/highlight'

/** Slim stand-in for the DDL tab: the rebuilt definition. */

export default function DdlRebuildPreview() {
  return (
    <div className="space-y-2 text-[11px] leading-tight text-[var(--sea-ink)]">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="island-kicker">DDL · data_widget</span>
        <span className="text-[var(--sea-ink-soft)]">
          <Marked step="comment">rebuilt from the catalog, not stored</Marked>
        </span>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[rgba(23,58,64,0.06)] p-3 font-mono text-[10.5px] leading-relaxed">
        <code>
          {'CREATE TABLE public.data_widget (\n'}
          <Marked step="columns">{'  id uuid NOT NULL DEFAULT gen_random_uuid(),'}</Marked>
          {'\n'}
          <Marked step="columns">{'  unit_id uuid NOT NULL,'}</Marked>
          {'\n'}
          <Marked step="constraints">{'  CONSTRAINT data_widget_pkey PRIMARY KEY (id),'}</Marked>
          {'\n'}
          <Marked step="constraints">
            {'  CONSTRAINT data_widget_unit_fk FOREIGN KEY (unit_id)\n    REFERENCES data_zone(id) ON DELETE CASCADE'}
          </Marked>
          {'\n);\n'}
          <Marked step="indexes">
            {'CREATE INDEX data_widget_status_idx ON public.data_widget (status);'}
          </Marked>
        </code>
      </pre>
    </div>
  )
}
