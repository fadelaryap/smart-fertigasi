"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export function FilterForm({ basePath, startDate, endDate, sort, q, resetPath, csvPath }: { basePath: string, startDate: string, endDate: string, sort: string, q?: string, resetPath: string, csvPath?: string }) {
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const sp = new URLSearchParams();
    const sd = formData.get("startDate") as string;
    const ed = formData.get("endDate") as string;
    const s = formData.get("sort") as string;
    const query = formData.get("q") as string;
    if (sd) sp.set("startDate", sd);
    if (ed) sp.set("endDate", ed);
    if (s) sp.set("sort", s);
    if (query) sp.set("q", query);
    
    router.push(`${basePath}?${sp.toString()}`, { scroll: false });
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: "10px", padding: "12px 16px", borderBottom: "1px solid var(--border)", alignItems: "center", flexWrap: "wrap" }}>
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
      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        <input type="text" name="q" placeholder="Cari..." defaultValue={q} style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)", width: "140px" }} />
      </div>
      <button type="submit" className="btn-secondary" style={{ padding: "6px 16px", borderRadius: 6, background: "var(--panel-solid)", border: "1px solid var(--border)", color: "var(--fg)", cursor: "pointer" }}>Filter</button>
      <Link href={resetPath} scroll={false} className="btn-secondary muted" style={{ padding: "6px 16px", borderRadius: 6, textDecoration: "none", background: "transparent", border: "1px solid transparent" }}>Reset</Link>
      
      {csvPath && (
        <a href={`${csvPath}?${new URLSearchParams({ ...(startDate && {startDate}), ...(endDate && {endDate}), ...(sort && {sort}), ...(q && {q}) }).toString()}`} className="btn-secondary" style={{ marginLeft: "auto", padding: "6px 16px", borderRadius: 6, textDecoration: "none", background: "var(--primary)", border: "none", color: "#fff" }}>
          Export CSV
        </a>
      )}
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
        <Link href={getPageUrl(page - 1)} scroll={false} className="btn-secondary" style={{ padding: "6px 12px", borderRadius: 6, textDecoration: "none", fontSize: 13, background: "var(--panel-solid)", border: "1px solid var(--border)", color: "var(--fg)" }}>
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
          <Link key={i} href={getPageUrl(p as number)} scroll={false} style={{ padding: "4px 10px", borderRadius: 6, textDecoration: "none", fontSize: 13, background: p === page ? "var(--primary)" : "var(--panel-solid)", color: p === page ? "#fff" : "var(--fg)", border: p === page ? "none" : "1px solid var(--border)", fontWeight: p === page ? "bold" : "normal" }}>
            {p}
          </Link>
        ))}
      </div>

      {page < totalPages ? (
        <Link href={getPageUrl(page + 1)} scroll={false} className="btn-secondary" style={{ padding: "6px 12px", borderRadius: 6, textDecoration: "none", fontSize: 13, background: "var(--panel-solid)", border: "1px solid var(--border)", color: "var(--fg)" }}>
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
