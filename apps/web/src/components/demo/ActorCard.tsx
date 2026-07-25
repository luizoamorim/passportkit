/**
 * One participant in the demo world, as a card: who they are, a badge for their
 * headline state, a stack of label/value rows, then whatever they can DO.
 *
 * Deliberately generic — the rows are `(label, node)` pairs and the actions are
 * children — because the same card carries a markets actor (claims, pool access,
 * LP positions) and a concierge owner or agent (standing, mandate, balances).
 * It knows nothing about either vocabulary.
 */

export interface ActorCardRow {
  label: string;
  value: React.ReactNode;
  /** hint for a row the eye should land on (access verdicts, standing) */
  emphasis?: boolean;
}

export function ActorCard({
  name,
  role,
  badge,
  rows,
  children,
}: {
  name: string;
  role?: string;
  /** headline state — a `StatusPill`, usually */
  badge?: React.ReactNode;
  rows: ActorCardRow[];
  /** action controls, rendered under the rows */
  children?: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-[#DDE1EA] rounded-xl p-5 flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[#0D1428] capitalize">{name}</h2>
          {role && <p className="text-xs text-[#4B5568] mt-0.5">{role}</p>}
        </div>
        {badge}
      </div>

      <dl className="mt-3">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-3 py-1.5 border-b border-[#F1F3F7] last:border-b-0"
          >
            <dt className={`text-xs ${row.emphasis ? 'text-[#0D1428] font-semibold' : 'text-[#4B5568]'}`}>
              {row.label}
            </dt>
            <dd className="flex items-center gap-1.5 text-right">{row.value}</dd>
          </div>
        ))}
      </dl>

      {children && <div className="mt-4">{children}</div>}
    </section>
  );
}
