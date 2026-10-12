const fold = (text) => String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
for (const root of document.querySelectorAll("[data-people-directory]")) {
  const query = root.querySelector("[data-directory-query]");
  const branch = root.querySelector("[data-directory-branch]");
  const place = root.querySelector("[data-directory-place]");
  const count = root.querySelector("[data-directory-count]");
  const entries = [...root.querySelectorAll("[data-person-entry]")];
  const update = () => {
    const q = fold(query.value);
    const branchId = branch.value;
    const placeValue = place.value;
    let shown = 0;
    for (const entry of entries) {
      const matchesText = !q || fold(entry.dataset.searchText).includes(q);
      const branches = entry.dataset.branchIds.split(" ").filter(Boolean);
      const matchesBranch = !branchId || branches.includes(branchId);
      const places = entry.dataset.placeValues.split("|").filter(Boolean);
      const matchesPlace = !placeValue || places.includes(placeValue);
      const visible = matchesText && matchesBranch && matchesPlace;
      entry.hidden = !visible;
      if (visible) shown += 1;
    }
    count.textContent = shown + (shown === 1 ? " pessoa" : " pessoas") + " neste conjunto publicado.";
  };
  query.addEventListener("input", update);
  branch.addEventListener("change", update);
  place.addEventListener("change", update);
}
