# InfoJOB â€” AutomaÃ§Ã£o INFOJUD
**VersÃ£o:** 2.2.0  
**Desenvolvedores:** Rodrigo Madalosso Araujo (TRT18) Â· Leandro VinÃ­cius de MagalhÃ£es Rodrigues (TRT19)

---

## O que Ã©

ExtensÃ£o para Chrome que automatiza consultas INFOJUD no eCAC da Receita Federal, a partir de uma planilha Excel ou ODS com processos judiciais.

---

## Novidades da v2.2.0

- **Processamento em lotes automÃ¡tico** â€” solicitaÃ§Ãµes com mais de 10 itens sÃ£o divididas e enviadas em lotes sequenciais para a mesma parte, sem intervenÃ§Ã£o manual
- **AtÃ© 10 anos por tipo de consulta** â€” limite ampliado de 5 para 10 anos
- **Nome oficial da Receita Federal** â€” a extensÃ£o captura o nome do contribuinte diretamente do eCAC apÃ³s o primeiro pedido incluÃ­do
- **Coluna de nomes opcional** â€” checkbox no popup permite usar a extensÃ£o sem coluna de nomes na planilha; placeholders (Parte 1, Parte 2...) sÃ£o substituÃ­dos automaticamente pelo nome oficial
- **Log .txt automÃ¡tico** â€” ao concluir envio e coleta, um arquivo de log Ã© salvo na pasta de saÃ­da com os nÃºmeros dos processos processados
- **Limpeza automÃ¡tica do storage** â€” dados temporÃ¡rios de processamento sÃ£o removidos automaticamente ao concluir cada operaÃ§Ã£o

---

## InstalaÃ§Ã£o

### Chrome
1. Extraia o arquivo `infojob_vX.X.X.zip` em uma pasta permanente
2. Abra `chrome://extensions/`
3. Ative o **Modo desenvolvedor** (canto superior direito)
4. Clique em **Carregar sem compactaÃ§Ã£o**
5. Selecione a pasta extraÃ­da
6. A extensÃ£o aparecerÃ¡ na barra de ferramentas

> âš ï¸ NÃ£o mova nem exclua a pasta apÃ³s a instalaÃ§Ã£o.

---

## ConfiguraÃ§Ã£o inicial

Na primeira instalaÃ§Ã£o, a pÃ¡gina de **ConfiguraÃ§Ãµes** abrirÃ¡ automaticamente. Configure:

- **Tipo do processo** â€” padrÃ£o: AÃ§Ã£o Trabalhista
- **Justificativa** â€” padrÃ£o: execuÃ§Ã£o
- **Vara** â€” digite exatamente como aparece no dropdown do eCAC  
  Ex: `008 - 8Âª Vara do Trabalho de GoiÃ¢nia`
- **Pasta de saÃ­da** â€” subpasta dentro de Downloads onde os PDFs serÃ£o salvos
- **Consultas CPF/CNPJ** â€” marque as que deseja realizar e configure os anos (atÃ© 10)

---

## Como usar

1. FaÃ§a login no **eCAC** com seu certificado digital
2. Entre no sistema **INFOJUD** (InformaÃ§Ãµes ao JudiciÃ¡rio)
3. Clique no Ã­cone do InfoJOB na barra de ferramentas
4. Clique em **Selecionar planilha**
5. Configure as colunas e linha inicial conforme sua planilha
6. Confira o resumo e clique em **â–¶ Executar automaÃ§Ã£o**
7. Aguarde â€” a extensÃ£o processarÃ¡ todos os lotes automaticamente
8. Quando as respostas chegarem na Caixa Postal, clique em **Salvar respostas**

---

## Formato da planilha

| Coluna | ConteÃºdo |
|--------|----------|
| A (padrÃ£o) | NÃºmero do processo (ex: 0000030-14.2025.5.18.0008) |
| I (padrÃ£o) | Nome da parte â€” opcional, configurÃ¡vel |
| H (padrÃ£o) | CPF ou CNPJ |

- Os dados comeÃ§am na **linha 8** por padrÃ£o (configurÃ¡vel)
- Linhas duplicadas (mesmo processo + CPF/CNPJ) sÃ£o ignoradas automaticamente
- A coluna de nomes Ã© opcional â€” marque/desmarque no popup
- A pontuaÃ§Ã£o Ã© removida automaticamente

---

## Processamento em lotes

O InfoJOB divide automaticamente solicitaÃ§Ãµes com mais de 10 itens em mÃºltiplos lotes:

| ConfiguraÃ§Ã£o | Total | Lotes |
|---|---|---|
| DIRPF (10 anos) + eFinanceira (10 anos) | 20 | 2 automÃ¡ticos |
| DIRPF (10) + DITR + DOI + DECRED + DIMOB + eFinanceira (10) | 26 | 3 automÃ¡ticos |

NÃ£o hÃ¡ limite prÃ¡tico de itens por parte.

---

## Nome dos arquivos gerados

```
NUMERODOPROCESSO_NOME SOBRENOME TIPOCONSULTA.pdf
```

Exemplo:
```
00112345620265180008_WILLIAM TASSIO DIRPF 2025.pdf
00112345620265180008_WILLIAM TASSIO eFinanceira 01_2024 a 12_2024.zip
```

O nome usa os dois primeiros tokens vÃ¡lidos do nome oficial da Receita Federal (tokens com ponto sÃ£o ignorados).

---

## Log de operaÃ§Ãµes

Ao concluir cada operaÃ§Ã£o, um arquivo `.txt` Ã© salvo automaticamente na pasta de saÃ­da:

```
InfoJOB_Log_envio_2026-05-15_11h00.txt
InfoJOB_Log_coleta_2026-05-15_12h00.txt
```

ContÃ©m os nÃºmeros dos processos processados com sucesso e os que tiveram erro.

---

## ProteÃ§Ã£o de dados

Esta extensÃ£o processa dados fiscais protegidos pela LGPD.

- Os dados **nÃ£o sÃ£o enviados para servidores externos**
- Tudo roda localmente no navegador do usuÃ¡rio
- As configuraÃ§Ãµes sÃ£o salvas apenas no armazenamento local do navegador
- Os dados temporÃ¡rios de processamento sÃ£o **removidos automaticamente** ao concluir cada operaÃ§Ã£o
- A extensÃ£o nÃ£o utiliza InteligÃªncia Artificial

---

## Suporte

Em caso de dÃºvidas, contate os desenvolvedores:
- **Rodrigo Madalosso Araujo** â€” TRT 18Âª RegiÃ£o Â· rodrigo.araujo@trt18.jus.br
- **Leandro VinÃ­cius de MagalhÃ£es Rodrigues** â€” TRT 19Âª RegiÃ£o Â· leandro.rodrigues@trt19.jus.br
