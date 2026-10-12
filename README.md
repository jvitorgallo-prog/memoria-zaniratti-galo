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

Ver `docs/BANCO.md`, `docs/BANCO-VALIDACAO.txt` e `docs/BANCO-INSPECAO.sql`. A migration foi criada pela Supabase CLI; o schema e o importador foram executados em PGlite isolado. A criação do Supabase hospedado e a aplicação da migration dependem da escolha da organização e da confirmação de custo. Não alterar projetos clínicos existentes.

## Conteúdo e documentos

As 26 fichas documentais incluem 22 referências de repositórios públicos e quatro referências mínimas a documentos fornecidos. As certidões integrais permanecem no acervo de pesquisa. O catálogo histórico reúne 363 itens com metadados; isso não define o universo do site original. A imagem do Attività com a família ainda não foi localizada ou comprovada. A mãe de Valentim permanece desconhecida; Reni e Lourdes Espósito são pessoas distintas.

## Estado da entrega

Implementação e ensaio local concluídos. A projeção foi revisada pela coordenação. Publicação GitHub Pages ainda depende de autenticação de escrita válida e de um repositório próprio; uma tentativa de criação retornou HTTP 401. Não há projeto Supabase remoto criado por esta entrega. A conexão de leitura do GitHub continua disponível.
