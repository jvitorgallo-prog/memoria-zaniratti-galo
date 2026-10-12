const foldCatalog = (text) => String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
for (const root of document.querySelectorAll("[data-legacy-catalog]")) {
  const input = root.querySelector("[data-catalog-query]");
  const count = root.querySelector("[data-catalog-count]");
  const entries = [...root.querySelectorAll("[data-catalog-entry]")];
  input.addEventListener("input", () => {
    const query = foldCatalog(input.value);
    let shown = 0;
    for (const entry of entries) {
      const visible = !query || foldCatalog(entry.dataset.catalogText).includes(query);
      entry.hidden = !visible;
      if (visible) shown += 1;
    }
    count.textContent = shown + (shown === 1 ? " item listado." : " itens listados.");
  });
}
