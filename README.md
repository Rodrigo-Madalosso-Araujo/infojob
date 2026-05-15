# InfoJOB — Automação INFOJUD
**Versão:** 2.2.0  
**Desenvolvedores:** Rodrigo Madalosso Araujo (TRT18) · Leandro Vinícius de Magalhães Rodrigues (TRT19)

---

## O que é

Extensão para Chrome que automatiza consultas INFOJUD no eCAC da Receita Federal, a partir de uma planilha Excel ou ODS com processos judiciais.

---

## Novidades da v2.2.0

- **Processamento em lotes automático** — solicitações com mais de 10 itens são divididas e enviadas em lotes sequenciais para a mesma parte, sem intervenção manual
- **Até 10 anos por tipo de consulta** — limite ampliado de 5 para 10 anos
- **Nome oficial da Receita Federal** — a extensão captura o nome do contribuinte diretamente do eCAC após o primeiro pedido incluído
- **Coluna de nomes opcional** — checkbox no popup permite usar a extensão sem coluna de nomes na planilha; placeholders (Parte 1, Parte 2...) são substituídos automaticamente pelo nome oficial
- **Log .txt automático** — ao concluir envio e coleta, um arquivo de log é salvo na pasta de saída com os números dos processos processados
- **Limpeza automática do storage** — dados temporários de processamento são removidos automaticamente ao concluir cada operação

---

## Instalação

### Chrome
1. Extraia o arquivo `infojob_vX.X.X.zip` em uma pasta permanente
2. Abra `chrome://extensions/`
3. Ative o **Modo desenvolvedor** (canto superior direito)
4. Clique em **Carregar sem compactação**
5. Selecione a pasta extraída
6. A extensão aparecerá na barra de ferramentas

> ⚠️ Não mova nem exclua a pasta após a instalação.

---

## Configuração inicial

Na primeira instalação, a página de **Configurações** abrirá automaticamente. Configure:

- **Tipo do processo** — padrão: Ação Trabalhista
- **Justificativa** — padrão: execução
- **Vara** — digite exatamente como aparece no dropdown do eCAC  
  Ex: `008 - 8ª Vara do Trabalho de Goiânia`
- **Pasta de saída** — subpasta dentro de Downloads onde os PDFs serão salvos
- **Consultas CPF/CNPJ** — marque as que deseja realizar e configure os anos (até 10)

---

## Como usar

1. Faça login no **eCAC** com seu certificado digital
2. Entre no sistema **INFOJUD** (Informações ao Judiciário)
3. Clique no ícone do InfoJOB na barra de ferramentas
4. Clique em **Selecionar planilha**
5. Configure as colunas e linha inicial conforme sua planilha
6. Confira o resumo e clique em **▶ Executar automação**
7. Aguarde — a extensão processará todos os lotes automaticamente
8. Quando as respostas chegarem na Caixa Postal, clique em **Salvar respostas**

---

## Formato da planilha

| Coluna | Conteúdo |
|--------|----------|
| A (padrão) | Número do processo (ex: 0000030-14.2025.5.18.0008) |
| I (padrão) | Nome da parte — opcional, configurável |
| H (padrão) | CPF ou CNPJ |

- Os dados começam na **linha 8** por padrão (configurável)
- Linhas duplicadas (mesmo processo + CPF/CNPJ) são ignoradas automaticamente
- A coluna de nomes é opcional — marque/desmarque no popup
- A pontuação é removida automaticamente

---

## Processamento em lotes

O InfoJOB divide automaticamente solicitações com mais de 10 itens em múltiplos lotes:

| Configuração | Total | Lotes |
|---|---|---|
| DIRPF (10 anos) + eFinanceira (10 anos) | 20 | 2 automáticos |
| DIRPF (10) + DITR + DOI + DECRED + DIMOB + eFinanceira (10) | 26 | 3 automáticos |

Não há limite prático de itens por parte.

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

O nome usa os dois primeiros tokens válidos do nome oficial da Receita Federal (tokens com ponto são ignorados).

---

## Log de operações

Ao concluir cada operação, um arquivo `.txt` é salvo automaticamente na pasta de saída:

```
InfoJOB_Log_envio_2026-05-15_11h00.txt
InfoJOB_Log_coleta_2026-05-15_12h00.txt
```

Contém os números dos processos processados com sucesso e os que tiveram erro.

---

## Proteção de dados

Esta extensão processa dados fiscais protegidos pela LGPD.

- Os dados **não são enviados para servidores externos**
- Tudo roda localmente no navegador do usuário
- As configurações são salvas apenas no armazenamento local do navegador
- Os dados temporários de processamento são **removidos automaticamente** ao concluir cada operação
- A extensão não utiliza Inteligência Artificial

---

## Suporte

Em caso de dúvidas, contate os desenvolvedores:
- **Rodrigo Madalosso Araujo** — TRT 18ª Região · rodrigo.araujo@trt18.jus.br
- **Leandro Vinícius de Magalhães Rodrigues** — TRT 19ª Região · leandro.rodrigues@trt19.jus.br
