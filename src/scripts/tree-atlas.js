const atlas = document.querySelector("[data-atlas]");
if (atlas) {
  const dataNode = atlas.querySelector("[data-atlas-data]");
  const data = JSON.parse(dataNode?.textContent || "{}");
  const people = data.people || [];
  const branches = data.branches || [];
  const assertions = data.assertions || [];
  const groups = data.groups || [];
  const byId = new Map(people.map((person) => [person.id, person]));
  const parentMap = new Map();
  const childMap = new Map();
  const explicitSiblingMap = new Map();
  for (const claim of assertions) {
    if (claim.interpretation === "disputed") continue;
    if (claim.predicate === "sibling_of" && claim.object_person_id) {
      if (!explicitSiblingMap.has(claim.subject_id)) explicitSiblingMap.set(claim.subject_id, new Set());
      if (!explicitSiblingMap.has(claim.object_person_id)) explicitSiblingMap.set(claim.object_person_id, new Set());
      explicitSiblingMap.get(claim.subject_id).add(claim.object_person_id);
      explicitSiblingMap.get(claim.object_person_id).add(claim.subject_id);
    }
    if (claim.predicate !== "child_of" || !claim.object_person_id) continue;
    if (!parentMap.has(claim.subject_id)) parentMap.set(claim.subject_id, new Set());
    parentMap.get(claim.subject_id).add(claim.object_person_id);
    if (!childMap.has(claim.object_person_id)) childMap.set(claim.object_person_id, new Set());
    childMap.get(claim.object_person_id).add(claim.subject_id);
  }
  const unions = groups.filter((group) => group.kind === "union");
  const unionMap = new Map();
  for (const group of unions) {
    for (const id of group.participant_ids || []) {
      if (!unionMap.has(id)) unionMap.set(id, []);
      unionMap.get(id).push({ group, partners: (group.participant_ids || []).filter((other) => other !== id) });
    }
  }
  const journeyAvailable = atlas.dataset.journeyAvailable === "true";
  const selectedPath = journeyAvailable ? ["luigi", "pasqua", "custode", "valentim", "reni", "rejane", "jv"] : [];
  const pathEdges = journeyAvailable ? new Set(["luigi:custode", "pasqua:custode", "custode:valentim", "valentim:reni", "reni:rejane", "rejane:jv"]) : new Set();
  const $ = (selector) => atlas.querySelector(selector);
  const base = atlas.dataset.personBase || "/pt/pessoas/";
  const sourceBase = atlas.dataset.sourceBase || "/pt/fontes/";
  const archiveBase = atlas.dataset.archiveBase || "/pt/acervo/";
  const branchBase = atlas.dataset.branchBase || "/pt/arvores/";
  const home = atlas.dataset.home || "/pt/";
  const normalize = (value) => (value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
  const initialFocus = atlas.dataset.initialPerson || "";
  const currentBranchId = atlas.dataset.currentBranch || "";
  const safeStateKey = `zaniratti-atlas-state-v1:${currentBranchId || "unassigned"}`;
  let saved = {};
  try { saved = JSON.parse(sessionStorage.getItem(safeStateKey) || "{}"); } catch { saved = {}; }
  const params = new URLSearchParams(location.search);
  const routeFocus = params.get("pessoa") || params.get("focus");
  const routeBranch = branches.find((branch) => branch.id === params.get("ramo"));
  const currentBranch = branches.find((branch) => branch.id === currentBranchId) || routeBranch;
  const branchPeople = (currentBranch?.person_ids || []).map((id) => byId.get(id)).filter(Boolean);
  const branchRoot = branchPeople.find((person) => !(parentMap.get(person.id) || new Set()).size) || branchPeople[0];
  const savedPersonIsCurrent = Boolean(saved.selectedId && (currentBranch?.person_ids || []).includes(saved.selectedId));
  let selectedId = routeFocus || (routeBranch ? (routeBranch.id === currentBranchId ? initialFocus : branchRoot?.id || initialFocus) : savedPersonIsCurrent ? saved.selectedId : initialFocus) || branchRoot?.id || "";
  if (!byId.has(selectedId)) selectedId = branchRoot?.id || initialFocus || "";
  let mode = saved.mode || "family";
  let zoom = Number(saved.zoom) || 1;
  let expanded = new Set(saved.expanded || []);
  let lineFocus = journeyAvailable && (params.get("caminho") === "jv" || Boolean(saved.lineFocus));
  const initialAtlasState = { selectedId, mode, zoom, expanded: new Set(expanded), lineFocus };

  function personUrl(id) { return `${base}${encodeURIComponent(id)}/`; }
  function initials(label) { return (label || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("pt-BR"); }
  function byName(ids) { return [...new Set(ids)].map((id) => byId.get(id)).filter(Boolean).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")); }
  function parentsOf(id) { return byName(parentMap.get(id) || []); }
  function childrenOf(id) { return byName(childMap.get(id) || []); }
  function siblingsOf(id) {
    const parentIds = parentMap.get(id) || new Set();
    return byName([...parentIds].flatMap((parentId) => [...(childMap.get(parentId) || [])]).concat([...(explicitSiblingMap.get(id) || [])])).filter((person) => person.id !== id);
  }
  function unionsOf(id) { return unionMap.get(id) || []; }
  function branchNames(person) { return (person.branch_ids || []).map((id) => branches.find((branch) => branch.id === id)?.label).filter(Boolean); }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function nodeLink(person, extraClass = "") {
    const link = element("a", `atlas-node ${extraClass}`.trim());
    link.href = personUrl(person.id);
    link.dataset.personId = person.id;
    link.setAttribute("aria-current", person.id === selectedId ? "true" : "false");
    const monogram = element("span", "atlas-node-monogram", initials(person.label));
    monogram.setAttribute("aria-hidden", "true");
    link.append(monogram, element("strong", "", person.label));
    const aliases = Array.isArray(person.aliases) ? person.aliases.filter((alias) => alias && alias !== person.label) : [];
    if (aliases[0]) link.append(element("small", "atlas-node-alias", aliases[0]));
    if (selectedPath.includes(person.id)) link.classList.add("is-line-person");
    if (person.id === selectedId) link.classList.add("is-selected");
    return link;
  }
  function miniLink(person, role) {
    const link = element("a", `atlas-mini-person ${person.id === selectedId ? "atlas-mini-selected" : ""}`);
    link.href = personUrl(person.id);
    link.dataset.personId = person.id;
    link.append(element("span", "", initials(person.label)), element("strong", "", person.label), element("small", "", role));
    return link;
  }
  function relationSourceIds(personId) {
    const claims = assertions.filter((claim) => claim.subject_kind === "person" && (claim.subject_id === personId || (claim.predicate === "child_of" && claim.object_person_id === personId)));
    const ids = new Set();
    for (const claim of claims) for (const citationId of claim.citation_ids || []) {
      const citation = (data.citations || []).find((item) => item.id === citationId);
      if (citation?.source_id) ids.add(citation.source_id);
    }
    for (const group of unionsOf(personId)) for (const eventId of group.group.event_ids || []) {
      const event = (data.events || []).find((item) => item.id === eventId);
      for (const claimId of event?.claim_ids || []) {
        const claim = assertions.find((item) => item.id === claimId);
        for (const citationId of claim?.citation_ids || []) {
          const citation = (data.citations || []).find((item) => item.id === citationId);
          if (citation?.source_id) ids.add(citation.source_id);
        }
      }
    }
    return [...ids].map((id) => (data.sources || []).find((source) => source.id === id)).filter(Boolean);
  }
  function storeState() {
    const canvas = $("[data-atlas-canvas]");
    const state = { selectedId, mode, zoom, expanded: [...expanded], lineFocus, scrollLeft: canvas?.scrollLeft || 0, scrollTop: canvas?.scrollTop || 0 };
    try { sessionStorage.setItem(safeStateKey, JSON.stringify(state)); } catch { /* unavailable storage is fine */ }
  }
  function pushLocation() {
    const url = new URL(home, location.href);
    url.searchParams.set("pessoa", selectedId);
    const branchId = (byId.get(selectedId)?.branch_ids || []).find((id) => [...$("[data-branch-select]").options].some((option) => option.value === id)) || "";
    if (branchId) url.searchParams.set("ramo", branchId); else url.searchParams.delete("ramo");
    if (lineFocus) url.searchParams.set("caminho", "jv"); else url.searchParams.delete("caminho");
    url.hash = selectedId;
    const canvas = $("[data-atlas-canvas]");
    history.pushState({ atlas: true, selectedId, mode, zoom, expanded: [...expanded], lineFocus, scrollLeft: canvas?.scrollLeft || 0, scrollTop: canvas?.scrollTop || 0 }, "", url);
  }
  function render() {
    const person = byId.get(selectedId);
    if (!person) return;
    const parents = parentsOf(selectedId);
    const grandparents = mode === "ancestors" ? byName(parents.flatMap((parent) => [...(parentMap.get(parent.id) || [])])) : [];
    const siblings = siblingsOf(selectedId);
    const children = childrenOf(selectedId);
    const branchSelect = $("[data-branch-select]");
    const visibleBranch = (person.branch_ids || []).find((id) => [...branchSelect.options].some((option) => option.value === id));
    branchSelect.value = visibleBranch || "";
    const spouseEntries = unionsOf(selectedId).flatMap(({ partners, group }) => partners.map((id) => ({ person: byId.get(id), group }))).filter((entry) => entry.person);
    const parentZone = $("[data-zone=parents]");
    parentZone.replaceChildren(...parents.map((item) => nodeLink(item)));
    parentZone.hidden = mode === "descendants" || parents.length === 0;
    $("[data-parent-link]").hidden = parentZone.hidden;
    $("[data-parent-link]").classList.toggle("is-line-edge", parents.some((parent) => pathEdges.has(`${parent.id}:${selectedId}`) || pathEdges.has(`${selectedId}:${parent.id}`)));
    const grandparentZone = $("[data-zone=grandparents]");
    grandparentZone.hidden = mode !== "ancestors" || grandparents.length === 0;
    $("[data-grandparent-cards]").replaceChildren(...grandparents.map((item) => nodeLink(item)));

    const selectedZone = $("[data-zone=selected]");
    const siblingZone = $("[data-zone=siblings]");
    const selectedLink = nodeLink(person, "atlas-node-selected");
    const unionWrap = $("[data-union]");
    selectedZone.replaceChildren(selectedLink, unionWrap, siblingZone);
    unionWrap.replaceChildren();
    for (const entry of spouseEntries) {
      const union = element("div", "atlas-union-pair");
      const marker = element("span", "atlas-union-mark");
      marker.setAttribute("aria-label", "União informada");
      union.append(marker, nodeLink(entry.person, "atlas-node-spouse"));
      unionWrap.append(union);
    }
    selectedZone.classList.toggle("has-union", spouseEntries.length > 0);

    const siblingCards = $("[data-sibling-cards]");
    siblingZone.hidden = mode !== "family" || siblings.length === 0;
    siblingZone.open = expanded.has("__siblings");
    $("[data-sibling-heading]").textContent = `Irmãos · ${siblings.length}`;
    siblingCards.replaceChildren(...siblings.map((item) => nodeLink(item, "atlas-node-sibling")));

    const childZone = $("[data-zone=children]");
    const childCards = $("[data-child-cards]");
    childZone.hidden = mode === "ancestors" || children.length === 0;
    $("[data-child-heading]").textContent = `${mode === "descendants" ? "Descendentes" : "Filhos"} · ${children.length}`;
    childCards.replaceChildren(...children.map((item) => childBranchCard(item)));
    $("[data-child-link]").hidden = childZone.hidden;
    $("[data-child-link]").classList.toggle("is-line-edge", children.some((child) => pathEdges.has(`${selectedId}:${child.id}`) || pathEdges.has(`${child.id}:${selectedId}`)));

    const grandZone = $("[data-zone=grandchildren]");
    grandZone.hidden = true;

    renderPanel(person, parents, siblings, children, spouseEntries);
    renderMobile(person, parents, siblings, children, spouseEntries);
    $("[data-atlas-tree]").classList.toggle("mode-ancestors", mode === "ancestors");
    $("[data-atlas-tree]").classList.toggle("mode-descendants", mode === "descendants");
    atlas.querySelectorAll("[data-mode]").forEach((button) => button.setAttribute("aria-pressed", button.dataset.mode === mode ? "true" : "false"));
    $("[data-line-route]").hidden = !lineFocus;
    $("[data-line-focus]").textContent = lineFocus ? "Ocultar percurso" : "Ver percurso";
    renderLineRoute();
    applyZoom();
    storeState();
  }
  function childBranchCard(child) {
    const wrapper = element("div", "atlas-child-branch");
    wrapper.append(nodeLink(child, "atlas-node-child"));
    const descendants = childrenOf(child.id);
    if (!descendants.length) return wrapper;
    const toggle = element("button", "atlas-expand-branch", `${expanded.has(child.id) ? "Recolher" : "Ver"} ${descendants.length} ${descendants.length === 1 ? "filho" : "filhos"}`);
    toggle.type = "button";
    toggle.dataset.expandPerson = child.id;
    toggle.setAttribute("aria-expanded", expanded.has(child.id) ? "true" : "false");
    wrapper.append(toggle);
    if (expanded.has(child.id)) {
      const subbranch = element("section", "atlas-subbranch");
      subbranch.setAttribute("aria-label", `Filhos de ${child.label}`);
      subbranch.append(element("h3", "", `Filhos de ${child.label} · ${descendants.length}`));
      const links = element("div", "atlas-subbranch-links");
      for (const descendant of descendants) links.append(nodeLink(descendant, "atlas-node-grandchild"));
      subbranch.append(links);
      wrapper.append(subbranch);
    }
    return wrapper;
  }
  function renderLineRoute() {
    const route = $("[data-line-route]");
    if (!journeyAvailable || !lineFocus) { route.replaceChildren(); return; }
    const ordered = ["luigi", "pasqua", "custode", "valentim", "reni", "rejane", "jv"].map((id) => byId.get(id)).filter(Boolean);
    route.replaceChildren();
    route.append(element("span", "atlas-route-title", "Percurso da família até João Vítor"));
    const list = element("div", "atlas-route-people");
    const couple = element("span", "atlas-route-couple");
    couple.setAttribute("aria-label", "Luigi e Pasqua, pais de Custode");
    for (const [index, person] of ordered.slice(0, 2).entries()) {
      if (index) couple.append(element("span", "atlas-route-plus", "+"));
      const link = element("a", person.id === selectedId ? "is-current" : "", person.label);
      link.href = personUrl(person.id);
      link.dataset.personId = person.id;
      couple.append(link);
    }
    list.append(couple, element("span", "atlas-route-arrow"));
    for (const person of ordered.slice(2)) {
      const link = element("a", person.id === selectedId ? "is-current" : "", person.label);
      link.href = personUrl(person.id);
      link.dataset.personId = person.id;
      list.append(link);
      if (person !== ordered.at(-1)) list.append(element("span", "atlas-route-arrow"));
    }
    route.append(list);
  }
  function renderPanel(person, parents, siblings, children, spouseEntries) {
    $("[data-panel-monogram]").textContent = initials(person.label);
    $("[data-panel-name]").textContent = person.label;
    $("[data-panel-meta]").textContent = branchNames(person).join(" · ") || "Memória da família Zaniratti";
    $("[data-panel-story]").href = personUrl(person.id);
    $("[data-mobile-story]").href = personUrl(person.id);
    $("[data-mobile-story]").textContent = `Abrir história de ${person.label}`;
    const archiveUrl = new URL(archiveBase, location.href);
    archiveUrl.searchParams.set("pessoa", person.id);
    $("[data-panel-docs]").href = archiveUrl.toString();
    $("[data-mobile-docs]").href = archiveUrl.toString();
    const counts = [];
    if (parents.length) counts.push(`${parents.length} ${parents.length === 1 ? "progenitor" : "progenitores"}`);
    if (siblings.length) counts.push(`${siblings.length} ${siblings.length === 1 ? "irmão" : "irmãos"}`);
    if (spouseEntries.length) counts.push(`${spouseEntries.length} ${spouseEntries.length === 1 ? "união" : "uniões"}`);
    if (children.length) counts.push(`${children.length} ${children.length === 1 ? "filho" : "filhos"}`);
    $("[data-panel-relation-copy]").textContent = counts.length ? counts.join(" · ") : "Nenhum vínculo familiar adicional está listado nesta seleção.";
    const sourceContainer = $("[data-panel-sources]");
    sourceContainer.replaceChildren();
    const sources = relationSourceIds(person.id);
    if (!sources.length) sourceContainer.append(element("p", "atlas-muted", "Consulte a ficha da pessoa para as referências disponíveis."));
    else for (const source of sources.slice(0, 5)) {
      const link = element("a", "atlas-source-link", source.title);
      link.href = `${sourceBase}${encodeURIComponent(source.id)}/`;
      sourceContainer.append(link);
    }
  }
  function renderMobile(person, parents, siblings, children, spouseEntries) {
    $("[data-mobile-heading]").textContent = `Família de ${person.label}`;
    const replaceLinks = (selector, entries, role) => $(selector).replaceChildren(...entries.map((entry) => miniLink(entry.person || entry, entry.role || role)));
    replaceLinks("[data-mobile-parents]", parents, "Pai ou mãe");
    replaceLinks("[data-mobile-focus]", [{ person, role: "Pessoa selecionada" }, ...spouseEntries.map((entry) => ({ person: entry.person, role: "União informada" }))], "");
    replaceLinks("[data-mobile-siblings]", siblings, "Irmão ou irmã");
    $("[data-mobile-siblings-section]").hidden = siblings.length === 0;
    $("[data-mobile-sibling-heading]").textContent = `Irmãos · ${siblings.length}`;
    replaceLinks("[data-mobile-children]", children, "Filho ou filha");
    $("[data-mobile-child-heading]").textContent = `Filhos · ${children.length}`;
  }
  function applyZoom() {
    const tree = $("[data-atlas-tree]");
    tree.style.setProperty("--atlas-zoom", String(zoom));
    $("[data-zoom-label]").textContent = `${Math.round(zoom * 100)}%`;
  }
  function selectPerson(id, { push = true } = {}) {
    if (!byId.has(id)) return;
    selectedId = id;
    if (push) pushLocation();
    render();
  }
  function searchResults(query) {
    const list = $("[data-atlas-results]");
    list.replaceChildren();
    const needle = normalize(query);
    if (!needle) { list.hidden = true; return; }
    const matches = people.map((person) => {
      const aliases = [person.label, ...(person.aliases || [])];
      const match = aliases.some((name) => normalize(name).includes(needle));
      return match ? person : null;
    }).filter(Boolean).slice(0, 8);
    for (const person of matches) {
      const item = element("li");
      const button = element("button", "atlas-result", person.label);
      const branch = branchNames(person).join(" · ");
      if (branch) button.append(element("small", "", branch));
      button.type = "button";
      button.addEventListener("click", () => { selectPerson(person.id); list.hidden = true; $("[data-atlas-search]").value = ""; });
      item.append(button); list.append(item);
    }
    if (!matches.length) list.append(element("li", "atlas-no-result", "Nenhuma pessoa encontrada."));
    list.hidden = false;
  }

  atlas.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-person-id]");
    if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) {
      event.preventDefault();
      selectPerson(link.dataset.personId);
      if (window.matchMedia("(max-width: 760px)").matches) $("[data-mobile-family]").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const modeButton = event.target.closest("[data-mode]");
    if (modeButton) { mode = modeButton.dataset.mode; render(); return; }
    const zoomButton = event.target.closest("[data-zoom]");
    if (zoomButton) {
      const action = zoomButton.dataset.zoom;
      if (action === "in") zoom = Math.min(1.35, zoom + 0.1);
      else if (action === "out") zoom = Math.max(0.7, zoom - 0.1);
      else {
        const canvas = $("[data-atlas-canvas]");
        const tree = $("[data-atlas-tree]");
        zoom = Math.max(0.7, Math.min(1, canvas.clientWidth / tree.scrollWidth));
      }
      applyZoom(); storeState(); return;
    }
    const expandButton = event.target.closest("[data-expand-person]");
    if (expandButton) {
      const id = expandButton.dataset.expandPerson;
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      render(); return;
    }
    if (event.target.closest("[data-line-focus]")) {
      lineFocus = !lineFocus;
      if (lineFocus) { mode = "family"; selectedId = "jv"; pushLocation(); }
      render(); return;
    }
    if (event.target.closest("[data-panel-family]")) { mode = "family"; render(); $("[data-atlas-canvas]").focus(); }
  });
  $("[data-atlas-search]").addEventListener("input", (event) => searchResults(event.target.value));
  $("[data-atlas-search]").addEventListener("keydown", (event) => {
    if (event.key === "Escape") { $("[data-atlas-results]").hidden = true; event.target.value = ""; }
    if (event.key === "Enter") { const first = $("[data-atlas-results] button"); if (first) first.click(); }
  });
  $("[data-branch-select]").addEventListener("change", (event) => {
    const branch = branches.find((item) => item.id === event.target.value);
    if (!branch) { render(); return; }
    // The destination route owns its complete graph and SSR-selected focus. A branch can be
    // valid even when none of its people are in this compact, local graph payload.
    const target = new URL(`${branchBase}${encodeURIComponent(branch.id)}/`, location.href);
    target.searchParams.set("ramo", branch.id);
    target.hash = "atlas";
    location.assign(target.toString());
  });
  $("[data-zone=siblings]").addEventListener("toggle", (event) => {
    if (event.currentTarget.open) expanded.add("__siblings"); else expanded.delete("__siblings");
    storeState();
  });
  $("[data-overview-toggle]").addEventListener("toggle", (event) => {
    atlas.classList.toggle("atlas-wide-open", event.currentTarget.open);
    if (event.currentTarget.open) requestAnimationFrame(() => $("[data-atlas-canvas]").scrollIntoView({ behavior: "smooth", block: "start" }));
  });
  window.addEventListener("popstate", () => {
    const state = history.state;
    const next = new URLSearchParams(location.search).get("pessoa") || new URLSearchParams(location.search).get("focus");
    selectedId = next && byId.has(next) ? next : initialAtlasState.selectedId;
    if (state?.atlas) {
      mode = state.mode || initialAtlasState.mode;
      zoom = state.zoom || initialAtlasState.zoom;
      expanded = new Set(state.expanded || []);
      lineFocus = journeyAvailable && Boolean(state.lineFocus);
    } else {
      mode = initialAtlasState.mode;
      zoom = initialAtlasState.zoom;
      expanded = new Set(initialAtlasState.expanded);
      lineFocus = initialAtlasState.lineFocus;
    }
    render();
    requestAnimationFrame(() => {
      const canvas = $("[data-atlas-canvas]");
      canvas.scrollLeft = state?.atlas ? state.scrollLeft || 0 : saved.scrollLeft || 0;
      canvas.scrollTop = state?.atlas ? state.scrollTop || 0 : saved.scrollTop || 0;
    });
  });
  render();
  $("[data-atlas-canvas]").addEventListener("scroll", () => {
    clearTimeout(window.__atlasScrollSave);
    window.__atlasScrollSave = setTimeout(storeState, 120);
  }, { passive: true });
  if (Number.isFinite(saved.scrollLeft) || Number.isFinite(saved.scrollTop)) requestAnimationFrame(() => {
    const canvas = $("[data-atlas-canvas]");
    canvas.scrollLeft = saved.scrollLeft || 0;
    canvas.scrollTop = saved.scrollTop || 0;
  });
}
