# Memória das famílias Zaniratti e Galo

Site estático em português para consultar pessoas, ramos, documentos e referências recuperadas do zaniratti.it. A primeira versão contém 89 pessoas e 118 vínculos citados. Relatos familiares, transcrições e documentos mantêm suas classes; ramos sem ponte demonstrada continuam separados.

## Executar

Requer Node.js 22.12 ou posterior (Node 24 usado na validação).

```sh
npm ci
npm run dev
```

Para publicar no GitHub Pages, use o workflow `.github/workflows/pages.yml`. Ele valida o conjunto público, exige sua aprovação editorial, verifica tipos e constrói o site antes do deploy. O caminho padrão é `/memoria-zaniratti-galo/`; `SITE_BASE=/` permite outra hospedagem. Não há chaves Supabase no navegador.

## Verificar e construir

```sh
npm run validate:public
npm run release:check
npm run test:public
npm run check
npm run build
```

O exportador requer explicitamente a base e os catálogos mantidos fora deste repositório. Ele gera um candidato e só o aprova com uma decisão editorial externa vinculada ao seu hash. Nunca inserir o corpus editorial completo, certidões, e-mails ou SQL de importação com dados pessoais no Git. O conjunto aprovado fica em `content/public/`; derivados permitidos ficam em `public/`.

## Banco editorial

Ver `docs/BANCO.md`, `docs/BANCO-VALIDACAO.txt` e `docs/BANCO-INSPECAO.sql`. A migration foi criada pela Supabase CLI e aplicada via MCP ao projeto hospedado escolhido pela família. O lote privado foi carregado em partes com verificação de hash, promovido atomicamente e teve a tabela temporária removida. A organização permanece no plano Free; o schema editorial fica isolado e inacessível aos papéis de navegador.

## Conteúdo e documentos

As 26 fichas documentais incluem 22 referências de repositórios públicos e quatro referências mínimas a documentos fornecidos. As certidões integrais permanecem no acervo de pesquisa. O catálogo histórico reúne 363 itens com metadados; isso não define o universo do site original. A imagem do Attività com a família ainda não foi localizada ou comprovada. A mãe de Valentim permanece desconhecida; Reni e Lourdes Espósito são pessoas distintas.

## Estado da entrega

Implementação, ensaio local, verificação do banco hospedado e deploy concluídos em 2026-10-12. A projeção foi revisada pela coordenação. O repositório público fornecido pela família é `jvitorgallo-prog/memoria-zaniratti-galo`; o workflow publica somente a versão editorial aprovada. O site está em [memoria-zaniratti-galo](https://jvitorgallo-prog.github.io/memoria-zaniratti-galo/). O GET da página inicial e da rota `/pt` respondeu HTTP 200; o QA em produção confirmou 12 rotas desktop e sete mobile com HTTP 200, busca por Reni e Custode, sem erros JavaScript nem overflow horizontal.

O banco remoto está no plano Free e foi instalado em um projeto existente, sem upgrade, pausa ou exclusão. O schema e os dados editoriais não são necessários para a leitura do site público e não são acessíveis pelos papéis de navegador.
