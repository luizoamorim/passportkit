/**
 * Placeholder body for a route the nav already lists but the plan has not built
 * yet, so the shell is never a link to a 404. Tasks 6 and 7 replace the two
 * pages that use it.
 */
export function ComingSoon({
  eyebrow,
  title,
  description,
  note,
}: {
  eyebrow: string;
  title: string;
  description: string;
  note: string;
}) {
  return (
    <div className="flex-1 bg-[#F0F2F6]">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF] mb-2">
          {eyebrow}
        </p>
        <h1 className="text-3xl font-bold text-[#0D1428] mb-4">{title}</h1>
        <p className="text-base text-[#4B5568] mb-8 leading-relaxed">{description}</p>
        <div className="bg-white border border-dashed border-[#DDE1EA] rounded-2xl p-6">
          <p className="text-[10px] font-semibold tracking-widest uppercase text-[#9CA3AF] mb-2">
            Not built yet
          </p>
          <p className="text-sm text-[#4B5568]">{note}</p>
        </div>
      </div>
    </div>
  );
}
