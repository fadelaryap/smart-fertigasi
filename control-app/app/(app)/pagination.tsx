import Link from "next/link";

export function FilterForm({ basePath, startDate, endDate, sort, resetPath }: { basePath: string, startDate: string, endDate: string, sort: string, resetPath: string }) {
  return (
    <form action={basePath} method="GET" style={{ display: "flex", gap: "10px", padding: "12px 16px", borderBottom: "1px solid var(--border)", alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        <span className="muted" style={{ fontSize: 13 }}>Tgl:</span>
        <input type="date" name="startDate" defaultValue={startDate} style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)" }} />
        <span className="muted">-</span>
        <input type="date" name="endDate" defaultValue={endDate} style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)" }} />
      </div>
      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        <span className="muted" style={{ fontSize: 13 }}>Urut:</span>
        <select name="sort" defaultValue={sort} style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)" }}>
          <option value="desc">Terbaru</option>
          <option value="asc">Terlama</option>
        </select>
      </div>
      <button type="submit" className="btn-secondary" style={{ padding: "6px 16px", borderRadius: 6, background: "var(--panel-solid)", border: "1px solid var(--border)", color: "var(--fg)", cursor: "pointer" }}>Filter</button>
      <Link href={resetPath} className="btn-secondary muted" style={{ padding: "6px 16px", borderRadius: 6, textDecoration: "none", background: "transparent", border: "1px solid transparent" }}>Reset</Link>
    </form>
  );
}

export function Pagination({ page, totalPages, basePath, searchParams }: { page: number, totalPages: number, basePath: string, searchParams: any }) {
  const getPageUrl = (p: number) => {
    const sp = new URLSearchParams();
    if (searchParams.startDate) sp.set("startDate", searchParams.startDate as string);
    if (searchParams.endDate) sp.set("endDate", searchParams.endDate as string);
    if (searchParams.sort) sp.set("sort", searchParams.sort as string);
    sp.set("page", p.toString());
    return `${basePath}?${sp.toString()}`;
  };

  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== "...") {
      pages.push("...");
    }
  }

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px", borderTop: "1px solid var(--border)" }}>
      {page > 1 ? (
        <Link href={getPageUrl(page - 1)} className="btn-secondary" style={{ padding: "6px 12px", borderRadius: 6, textDecoration: "none", fontSize: 13, background: "var(--panel-solid)", border: "1px solid var(--border)", color: "var(--fg)" }}>
          &larr; Prev
        </Link>
      ) : (
        <span className="btn-secondary muted" style={{ padding: "6px 12px", borderRadius: 6, fontSize: 13, background: "var(--panel-solid)", border: "1px solid var(--border)", opacity: 0.5 }}>
          &larr; Prev
        </span>
      )}

      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        {pages.map((p, i) => (
          p === "..." ? <span key={i} className="muted" style={{ padding: "0 4px" }}>...</span> :
          <Link key={i} href={getPageUrl(p as number)} style={{ padding: "4px 10px", borderRadius: 6, textDecoration: "none", fontSize: 13, background: p === page ? "var(--primary)" : "var(--panel-solid)", color: p === page ? "#fff" : "var(--fg)", border: p === page ? "none" : "1px solid var(--border)", fontWeight: p === page ? "bold" : "normal" }}>
            {p}
          </Link>
        ))}
      </div>

      {page < totalPages ? (
        <Link href={getPageUrl(page + 1)} className="btn-secondary" style={{ padding: "6px 12px", borderRadius: 6, textDecoration: "none", fontSize: 13, background: "var(--panel-solid)", border: "1px solid var(--border)", color: "var(--fg)" }}>
          Next &rarr;
        </Link>
      ) : (
        <span className="btn-secondary muted" style={{ padding: "6px 12px", borderRadius: 6, fontSize: 13, background: "var(--panel-solid)", border: "1px solid var(--border)", opacity: 0.5 }}>
          Next &rarr;
        </span>
      )}
    </div>
  );
}
