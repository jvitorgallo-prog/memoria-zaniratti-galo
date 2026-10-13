# Família Zaniratti — Memória da família

Atlas público para percorrer a árvore, abrir histórias pessoais e consultar documentos recuperados do zaniratti.it e da pesquisa familiar. Outros sobrenomes participam por casamento e descendência. A identidade e o foco são Zaniratti.

## Conteúdo desta edição

89 pessoas, 118 vínculos parentais, 7 uniões explicitamente informadas, 46 acontecimentos e 40 biografias com texto factual. As fichas pessoais mostram pais, irmãos, cônjuges e filhos completos, inclusive 13 filhos de Custode, 4 de Valentim, 5 de Reni, 10 de Grandilia e 16 de Zenaide.

O acervo reúne 389 itens; 388 têm arquivo de leitura disponível. Há páginas e imagens do website histórico, 22 PDFs de fontes públicas, o extrato original do casamento de Custode e Ernesta e três extratos genealógicos dos documentos fornecidos. Um registro possui captura indexada, sem bytes locais. A cobertura total do antigo domínio continua desconhecida.

Reni aparece conforme a correção familiar; Lourdes Espósito permanece outra pessoa. Relatos familiares e conteúdo do site integram a história com a origem consultável. Não se inferem parentescos, mães, adoções ou componentes de data ausentes.

## Executar e verificar

Requer Node.js 22.12+; o workflow usa Node 24.

```sh
npm ci
npm run dev
npm run validate:public
npm run test:public
npm run test:genealogy
npm run release:check
npm run check
npm run build
```

O site é Astro estático, publicado pelo workflow Pages. A árvore usa uma camada interativa progressiva; as fichas e os links continuam acessíveis sem JavaScript. Fontes são hospedadas localmente, com licenças em `public/fonts/`.

A URL é https://jvitorgallo-prog.github.io/memoria-zaniratti-galo/. O caminho técnico do repositório foi mantido para preservar links existentes. `SITE_BASE=/` adapta a compilação a outra hospedagem.

## Dados e preservação

O Supabase Free existente mantém o schema editorial privado. O navegador recebe somente a projeção pública versionada e nunca consulta esse schema ou recebe chave privilegiada. `content/public/manifest.json` vincula corpus, snapshot, inventário, imagens e GEDCOM por hashes. O exportador recebe explicitamente arquivos editoriais fora do checkout; não commitar documentos privados nem SQL de importação.

Páginas históricas têm versão de leitura sem scripts antigos. Links preservados apontam às cópias locais; recursos ausentes têm indicação legível. Os originais e o inventário de recuperação continuam no acervo de preservação independente.

A revisão do snapshot é registrada pela coordenação, dentro da autorização já dada pela família para a publicação. Não existe aprovação adicional por pessoa ou vínculo já autorizado. A CI verifica a integridade dos dados e arquivos antes de publicar.

Ver `docs/META-REDESENHO.md`, `docs/EDICAO-2026-10-13.md` e `docs/BANCO.md`.
