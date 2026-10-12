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
    const matches = data.filter((person) => normalize([person.label, person.branch, ...(person.aliases || [])].join(" ")).includes(query) && (!branch?.value || person.branchIds.includes(branch.value))).slice(0, 12);
    for (const person of matches) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = person.href;
      a.textContent = person.label;
      li.append(a);
      if (person.branch) { const small = document.createElement("small"); small.textContent = person.branch; li.append(small); }
      results.append(li);
    }
    if (!matches.length) { const li = document.createElement("li"); li.textContent = "Nenhuma pessoa encontrada neste recorte."; results.append(li); }
    results.hidden = false;
  };
  input?.addEventListener("input", render);
  branch?.addEventListener("change", render);
}
