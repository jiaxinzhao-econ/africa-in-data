"use strict";

const byId = (id) => document.getElementById(id);

function makeSourceCard(source) {
  const article = document.createElement("article");
  article.className = "source-item";
  const header = document.createElement("header");
  const identity = document.createElement("div");
  const code = document.createElement("code");
  code.textContent = source.currency_iso3;
  const title = document.createElement("h3");
  title.textContent = source.provider;
  const sourceTitle = document.createElement("p");
  sourceTitle.textContent = source.title;
  identity.append(code, title, sourceTitle);
  const link = document.createElement("a");
  link.className = "text-link";
  link.href = source.documentation_url || source.source_url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Official source →";
  header.append(identity, link);
  const definition = document.createElement("p");
  definition.textContent = source.rate_definition;
  const rights = document.createElement("small");
  rights.textContent = source.rights_note;
  article.append(header, definition, rights);
  return article;
}

async function initialise() {
  try {
    const [manifestResponse, sourcesResponse] = await Promise.all([
      fetch("data/manifest.json"),
      fetch("data/sources.json"),
    ]);
    if (!manifestResponse.ok || !sourcesResponse.ok) throw new Error("Source files unavailable.");
    const [manifest, sources] = await Promise.all([
      manifestResponse.json(),
      sourcesResponse.json(),
    ]);
    byId("methodology-status").textContent =
      `Data cutoff ${manifest.data_cutoff} · ${manifest.observation_count} observations · ` +
      `${manifest.currency_count} currencies`;
    byId("rights-notice").textContent = manifest.rights_notice;
    const list = byId("source-list");
    list.replaceChildren(...sources.map(makeSourceCard));
  } catch (error) {
    byId("methodology-status").textContent = `Manifest unavailable: ${error.message}`;
  }
}

initialise();
