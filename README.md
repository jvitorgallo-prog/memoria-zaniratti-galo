# Família Zaniratti — Memória da família

Atlas público para percorrer a árvore, abrir histórias pessoais e consultar documentos recuperados do zaniratti.it e da pesquisa familiar. Outros sobrenomes participam por casamento e descendência. A identidade e o foco são Zaniratti.

## Conteúdo desta edição

507 fichas e referências pessoais, 403 vínculos parentais distintos adotados, 62 uniões explicitamente informadas, 101 acontecimentos e 212 biografias com texto e fontes. A entrada apresenta as quatro árvores históricas principais — Salvatonica/San Biagio, Francesco/Bondeno, Porto Alegre e Giovanni Battista — além de versões, subárvores e fichas ainda sem ramo identificado. A família do autor Edmondo Lorenzo tem perfil próprio; seu relato histórico de residência e a memória de Milão mantêm suas respectivas fontes.

As fichas pessoais mostram pais, irmãos, cônjuges e filhos, inclusive 13 filhos de Custode, 4 de Valentim, 5 de Reni, 10 de Grandilia e 16 de Zenaide. Menções sem página individual preservada são referências; a contagem não garante que cada menção sem link corresponda a um indivíduo diferente.

O acervo reúne 389 itens; os 389 têm arquivo de leitura disponível. Há páginas e imagens do website histórico, 22 PDFs de fontes públicas, o extrato original do casamento de Custode e Ernesta e três extratos genealógicos dos documentos fornecidos. O catálogo de pesquisa torna 204 achados consultáveis por nome, fonte e estado, além de capítulos sobre ramos italianos, Santa Clara, Varre-Sai, fazendas e José Augusto.

Foram inventariados 239 arquivos HTM históricos e três interfaces HTML auxiliares da recuperação; 122 fichas contêm tabelas de relações e 11 páginas têm mapas de árvores. Algumas imagens dos diagramas não foram recuperadas. A cobertura total do domínio antigo continua desconhecida.

A revisão de 14/10/2026 recuperou `ITA/FontiI.htm`, captura de 21/10/2004, com bytes e digest conferidos. A página indica o Registro da População de Bondeno, Volume VIII, família 86; as duas miniaturas e páginas de documentos vinculadas continuam ausentes. Não é uma lista de passageiros do Attività. A galeria em `/pt/acervo/imagens/` reúne 106 imagens históricas únicas e oferece os originais em ZIP; as dez notas complementares e a auditoria estão em `/pt/fontes/`.

Reni aparece conforme a correção familiar; Lourdes Espósito permanece outra pessoa. Relatos familiares e conteúdo do site integram a história com a origem consultável. Não se inferem parentescos, mães, adoções ou componentes de data ausentes.

## Executar e verificar

Requer Node.js 22.12+; o workflow usa Node 24.

```sh
npm ci
npm run dev
npm run validate:public
npm run test:public
npm run test:genealogy
npm run test:images
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

O GEDCOM ampliado está em `public/downloads/familia-zaniratti.ged`; `linha-principal.ged` permanece como nome compatível. Ele exporta somente as filiações adotadas. As extensões `_PARENT` e `_PARTNER` registram vínculos sem atribuir sexo ou casamento; leitores que não aceitem essas extensões podem omitir relações. O snapshot JSON mantém as citações por fato e é a projeção estruturada integral.

Ver `docs/META-EXPANSAO-INTEGRAL.md`, `docs/EDICAO-INTEGRAL-2026-10-13.md` e `docs/BANCO.md`. A primeira edição permanece documentada em `docs/EDICAO-2026-10-13.md`.
