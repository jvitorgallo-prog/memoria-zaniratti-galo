const normalize = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
for (const root of document.querySelectorAll("[data-local-search]")) {
  const input = root.querySelector("[data-search-input]");
  const branch = root.querySelector("[data-search-branch]");
  const results = root.querySelector("[data-search-results]");
  const data = JSON.parse(root.querySelector("[data-search-data]")?.textContent || "[]");
  const render = () => {
    const query = normalize(input.value);
    results.replaceChildren();
    if (!query) { results.hidden = true; return; }
    const matches = data.filter((row) => {
      if (branch?.value && row.kind === "person" && !(row.branchIds || []).includes(branch.value)) return false;
      return normalize([row.label, row.branch, row.terms, ...(row.aliases || [])].filter(Boolean).join(" ")).includes(query);
    }).slice(0, 16);
    for (const row of matches) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = row.href;
      a.textContent = row.label;
      li.append(a);
      const detail = [row.kindLabel, row.branch].filter(Boolean).join(" · ");
      if (detail) { const small = document.createElement("small"); small.textContent = detail; li.append(small); }
      results.append(li);
    }
    if (!matches.length) { const li = document.createElement("li"); li.textContent = "Nenhum resultado encontrado."; results.append(li); }
    results.hidden = false;
  };
  input?.addEventListener("input", render);
  branch?.addEventListener("change", render);
}
