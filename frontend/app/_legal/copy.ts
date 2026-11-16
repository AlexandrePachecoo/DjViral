// Textos das páginas legais. O site no ar é só pt-BR; o inglês fica aqui para
// quando o locale `en` voltar (a infra do next-intl foi mantida).
//
// Tudo entre colchetes é dado que o Alexandre precisa preencher. Não inventar
// razão social, CNPJ, endereço, e-mail, prazo, gateway ou foro.

export type LegalSection = {
  heading: string;
  paragraphs: string[];
};

export type LegalDoc = {
  metaTitle: string;
  metaDescription: string;
  title: string;
  updated: string;
  draftNote: string;
  sections: LegalSection[];
};

const DRAFT_PT =
  "Rascunho para revisão. Os trechos em destaque, como [CNPJ] e [E-MAIL DE CONTATO], ainda não são dados reais da empresa e precisam ser preenchidos antes de publicar.";

const DRAFT_EN =
  "Draft for review. Highlighted bits such as [CNPJ] and [CONTACT EMAIL] are not real company details yet and must be filled in before publishing.";

export const privacy: Record<"pt" | "en", LegalDoc> = {
  pt: {
    metaTitle: "Política de Privacidade · DJviral",
    metaDescription:
      "Como a DJviral trata e-mail, conta, vídeos enviados e links do YouTube, em conformidade com a LGPD.",
    title: "Política de Privacidade",
    updated: "Última atualização: 16 de novembro de 2026",
    draftNote: DRAFT_PT,
    sections: [
      {
        heading: "1. Quem é o controlador",
        paragraphs: [
          "A DJviral é uma plataforma que transforma sets de DJ em cortes verticais 9:16. Esta política descreve quais dados pessoais tratamos, com qual finalidade e quais são os seus direitos, nos termos da Lei nº 13.709/2018 (Lei Geral de Proteção de Dados — LGPD).",
          "O controlador dos dados pessoais é [RAZÃO SOCIAL], inscrita no CNPJ sob o nº [CNPJ], com endereço em [ENDEREÇO]. O encarregado pelo tratamento de dados pessoais (art. 41 da LGPD) é [NOME DO ENCARREGADO], contatável em [E-MAIL DE CONTATO].",
        ],
      },
      {
        heading: "2. Dados que coletamos",
        paragraphs: [
          "Conta. Nome, e-mail e senha. A senha é guardada apenas como hash (scrypt); não armazenamos a senha em texto puro. A sessão usa um cookie httpOnly no seu navegador.",
          "Conteúdo que você envia. O arquivo de vídeo do set é enviado aos nossos servidores para ser analisado e cortado. Se você cola um link do YouTube, esse link também é processado em servidor: baixamos o vídeo para analisar o áudio e a imagem e gerar os cortes. O arquivo não permanece só no seu navegador.",
          "Uso do serviço. Identificadores da conta e do projeto, duração do set, estilo e quantidade de cortes pedidos, status do processamento e registros técnicos necessários para operar e diagnosticar falhas.",
          "Pagamento. Quando você assina um plano pago, a cobrança é feita pelo [GATEWAY DE PAGAMENTO]. Nós não guardamos o número completo do cartão nem o código de segurança. Guardamos o plano, o status da assinatura e os identificadores necessários para reconhecer o pagamento e aplicar a cota.",
          "Não pedimos dados sensíveis (origem racial, saúde, biometria, opinião política ou similares) para usar o serviço.",
        ],
      },
      {
        heading: "3. Para que usamos os dados",
        paragraphs: [
          "Criar e autenticar a sua conta.",
          "Receber o set (arquivo ou link do YouTube), analisá-lo e gerar os cortes verticais, inclusive títulos sugeridos quando a análise por IA estiver disponível no plano.",
          "Aplicar a cota de horas e o limite de cortes do plano, operar a assinatura e o cancelamento.",
          "Mostrar os cortes na sua conta e, se você ativar um link público, para quem tiver esse link.",
          "Atender pedidos de suporte, prevenir abuso e cumprir obrigação legal.",
        ],
      },
      {
        heading: "4. Base legal",
        paragraphs: [
          "Execução de contrato e de procedimentos preliminares (art. 7º, V, da LGPD): conta, processamento do set e assinatura.",
          "Consentimento (art. 7º, I), quando for a base aplicável — por exemplo, ao criar a conta e aceitar esta política e os Termos de Uso.",
          "Legítimo interesse (art. 7º, IX), limitado à segurança da plataforma, à prevenção de fraude e abuso e à manutenção do serviço, sempre com respeito aos seus direitos.",
          "Cumprimento de obrigação legal ou regulatória (art. 7º, II), quando uma norma exigir a guarda ou a divulgação de algum dado.",
        ],
      },
      {
        heading: "5. Retenção e exclusão",
        paragraphs: [
          "Mantemos os dados da conta, os vídeos enviados, os links processados e os cortes enquanto a conta estiver ativa e pelo prazo de [PRAZO DE RETENÇÃO] após o encerramento, ou pelo tempo estritamente necessário para cumprir obrigação legal, resolver disputa ou exercer direitos.",
          "O vídeo original fica em armazenamento de acesso restrito. Os cortes ficam disponíveis na sua conta. Se você gerar um link público, quem tiver o link consegue ver e baixar os cortes salvos até você desativar o link ou apagar o conteúdo.",
          "Você pode pedir a exclusão da conta, dos vídeos e dos cortes pelo [E-MAIL DE CONTATO]. Podemos recusar ou adiar um pedido apenas quando a lei permitir ou exigir a conservação.",
        ],
      },
      {
        heading: "6. Com quem compartilhamos",
        paragraphs: [
          "Não vendemos dados pessoais. Compartilhamos apenas o que é necessário para prestar o serviço, com operadores que tratam dados em nosso nome:",
          "hospedagem do site e da aplicação;",
          "armazenamento de arquivos e banco de dados;",
          "processamento dos vídeos em servidor (análise de áudio e imagem e geração dos cortes);",
          "o [GATEWAY DE PAGAMENTO], para cobrar a assinatura;",
          "e, quando você cola um link do YouTube, a obtenção desse vídeo a partir da plataforma de origem, só para executar o processamento que você pediu.",
          "Também podemos divulgar dados mediante ordem válida de autoridade ou para defender direito em processo. A relação nominal desses operadores será mantida por [RAZÃO SOCIAL] e pode ser pedida em [E-MAIL DE CONTATO].",
        ],
      },
      {
        heading: "7. Transferência internacional",
        paragraphs: [
          "Alguns operadores podem tratar dados fora do Brasil. Quando isso ocorrer, a transferência seguirá um mecanismo previsto na LGPD (por exemplo, cláusulas contratuais ou país com grau de proteção adequado), no que for aplicável.",
        ],
      },
      {
        heading: "8. Direitos do titular",
        paragraphs: [
          "Você pode pedir, em relação aos seus dados: confirmação de que há tratamento, acesso, correção de dados incompletos ou desatualizados, anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade, portabilidade, informação sobre com quem compartilhamos, e revogação do consentimento.",
          "Você também pode se opor a um tratamento baseado em legítimo interesse, quando a lei garantir essa oposição. Para exercer qualquer desses direitos, escreva para [E-MAIL DE CONTATO]. Podemos pedir uma confirmação de que o pedido é seu.",
          "Se entender que o tratamento viola a LGPD, você pode apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD).",
        ],
      },
      {
        heading: "9. Segurança",
        paragraphs: [
          "Adotamos medidas razoáveis para proteger os dados, como senha armazenada só como hash, cookie de sessão httpOnly e acesso restrito ao vídeo original. Nenhum sistema é isento de incidente. Se ocorrer um incidente com risco relevante aos seus direitos, comunicaremos nos termos da LGPD.",
        ],
      },
      {
        heading: "10. Crianças e adolescentes",
        paragraphs: [
          "A DJviral não é dirigida a crianças. A conta pressupõe alguém capaz de aceitar os Termos de Uso. Não coletamos intencionalmente dados de crianças. Se você acredita que uma criança criou conta, avise [E-MAIL DE CONTATO] para que os dados sejam analisados e, quando couber, excluídos.",
        ],
      },
      {
        heading: "11. Alterações desta política",
        paragraphs: [
          "Podemos atualizar este texto. A data no topo indica a versão vigente. Se a mudança for relevante para o tratamento dos seus dados, avisaremos por um meio razoável, como um aviso no site ou um e-mail para o endereço da conta.",
        ],
      },
      {
        heading: "12. Contato",
        paragraphs: [
          "[RAZÃO SOCIAL] · CNPJ [CNPJ] · [ENDEREÇO]",
          "Encarregado: [NOME DO ENCARREGADO] · [E-MAIL DE CONTATO]",
          "Os Termos de Uso estão em /termos.",
        ],
      },
    ],
  },
  en: {
    metaTitle: "Privacy Policy · DJviral",
    metaDescription:
      "How DJviral handles email, account data, uploaded videos and YouTube links under Brazil's LGPD.",
    title: "Privacy Policy",
    updated: "Last updated: November 16, 2026",
    draftNote: DRAFT_EN,
    sections: [
      {
        heading: "1. Who the controller is",
        paragraphs: [
          "DJviral turns DJ sets into vertical 9:16 clips. This policy explains which personal data we process, why, and what your rights are, under Brazil's Lei nº 13.709/2018 (LGPD).",
          "The controller is [LEGAL NAME], CNPJ [CNPJ], address [ADDRESS]. The data protection officer (LGPD art. 41) is [DPO NAME], reachable at [CONTACT EMAIL].",
        ],
      },
      {
        heading: "2. Data we collect",
        paragraphs: [
          "Account. Name, email and password. The password is stored only as a scrypt hash, never in plain text. The session uses an httpOnly cookie.",
          "Content you send. The set video is uploaded to our servers to be analyzed and cut. If you paste a YouTube link, that link is processed on the server too: we download the video to analyze the audio and picture and generate the clips. The file does not stay only in your browser.",
          "Use of the service. Account and project identifiers, set duration, the cut style and count you ask for, processing status, and technical logs needed to run the service and diagnose failures.",
          "Payment. Paid plans are billed by [PAYMENT GATEWAY]. We do not store the full card number or the security code. We store the plan, the subscription status and the identifiers needed to recognize the payment and apply the quota.",
          "We do not ask for sensitive data (racial origin, health, biometrics, political opinions or similar) in order to use the service.",
        ],
      },
      {
        heading: "3. Why we use the data",
        paragraphs: [
          "To create and authenticate your account.",
          "To receive the set (file or YouTube link), analyze it and generate the vertical clips, including suggested titles when AI analysis is available on the plan.",
          "To apply the plan's hour quota and clip limit, and to run the subscription and cancellation.",
          "To show the clips in your account and, if you turn on a public link, to anyone who has that link.",
          "To handle support requests, prevent abuse and meet a legal obligation.",
        ],
      },
      {
        heading: "4. Legal bases",
        paragraphs: [
          "Performance of a contract and preliminary procedures (LGPD art. 7, V): the account, set processing and the subscription.",
          "Consent (art. 7, I), where that is the applicable basis — for example when you create an account and accept this policy and the Terms of Use.",
          "Legitimate interest (art. 7, IX), limited to platform security, fraud and abuse prevention, and keeping the service running, with respect for your rights.",
          "Compliance with a legal or regulatory obligation (art. 7, II), when a rule requires us to keep or disclose some data.",
        ],
      },
      {
        heading: "5. Retention and deletion",
        paragraphs: [
          "We keep account data, uploaded videos, processed links and clips while the account is active and for [RETENTION PERIOD] after it ends, or for as long as strictly needed to meet a legal duty, resolve a dispute or exercise rights.",
          "The original video is stored with restricted access. Clips stay available in your account. If you create a public link, anyone with the link can view and download the saved clips until you turn the link off or delete the content.",
          "You can ask us to delete the account, the videos and the clips at [CONTACT EMAIL]. We may refuse or delay a request only when the law allows or requires us to keep the data.",
        ],
      },
      {
        heading: "6. Who we share data with",
        paragraphs: [
          "We do not sell personal data. We share only what is needed to provide the service, with operators acting on our behalf:",
          "hosting of the site and the application;",
          "file storage and the database;",
          "server-side video processing (audio and picture analysis and clip generation);",
          "[PAYMENT GATEWAY], to charge the subscription;",
          "and, when you paste a YouTube link, fetching that video from the source platform solely to run the processing you asked for.",
          "We may also disclose data under a valid order from an authority, or to defend a right in a proceeding. The named list of operators is kept by [LEGAL NAME] and can be requested at [CONTACT EMAIL].",
        ],
      },
      {
        heading: "7. International transfers",
        paragraphs: [
          "Some operators may process data outside Brazil. When that happens, the transfer follows a mechanism provided by the LGPD (for example contractual clauses, or a country with an adequate level of protection), where applicable.",
        ],
      },
      {
        heading: "8. Your rights",
        paragraphs: [
          "You may request, for your data: confirmation that processing exists, access, correction of incomplete or outdated data, anonymization, blocking or deletion of unnecessary data or data processed unlawfully, portability, information about who we share data with, and withdrawal of consent.",
          "You may also object to processing based on legitimate interest, where the law gives you that right. To exercise any of these rights, write to [CONTACT EMAIL]. We may ask you to confirm the request is yours.",
          "If you believe the processing violates the LGPD, you may file a complaint with the Brazilian data protection authority (ANPD).",
        ],
      },
      {
        heading: "9. Security",
        paragraphs: [
          "We take reasonable measures to protect the data, such as storing the password only as a hash, an httpOnly session cookie, and restricted access to the original video. No system is free of incidents. If an incident creates a relevant risk to your rights, we will notify as the LGPD requires.",
        ],
      },
      {
        heading: "10. Children and teenagers",
        paragraphs: [
          "DJviral is not directed at children. An account assumes someone able to accept the Terms of Use. We do not knowingly collect children's data. If you believe a child created an account, write to [CONTACT EMAIL] so the data can be reviewed and, where appropriate, deleted.",
        ],
      },
      {
        heading: "11. Changes to this policy",
        paragraphs: [
          "We may update this text. The date at the top is the current version. If a change matters to how your data is processed, we will give a reasonable notice, such as a notice on the site or an email to the account address.",
        ],
      },
      {
        heading: "12. Contact",
        paragraphs: [
          "[LEGAL NAME] · CNPJ [CNPJ] · [ADDRESS]",
          "Data protection officer: [DPO NAME] · [CONTACT EMAIL]",
          "The Terms of Use are at /termos.",
        ],
      },
    ],
  },
};

export const terms: Record<"pt" | "en", LegalDoc> = {
  pt: {
    metaTitle: "Termos de Uso · DJviral",
    metaDescription:
      "Regras da conta DJviral: assinatura mensal sem fidelidade, cancelamento, uso aceitável e responsabilidade pelo conteúdo enviado.",
    title: "Termos de Uso",
    updated: "Última atualização: 16 de novembro de 2026",
    draftNote: DRAFT_PT,
    sections: [
      {
        heading: "1. Aceitação",
        paragraphs: [
          "Estes Termos de Uso regulam o acesso à DJviral, operada por [RAZÃO SOCIAL], CNPJ [CNPJ], endereço [ENDEREÇO]. Ao criar uma conta ou usar o serviço, você concorda com estes termos e com a Política de Privacidade (/privacidade).",
          "Se você não concorda, não crie a conta e não envie conteúdo.",
        ],
      },
      {
        heading: "2. O serviço",
        paragraphs: [
          "A DJviral recebe um set em arquivo de vídeo ou por link do YouTube, analisa o material em nossos servidores e devolve cortes verticais no formato 9:16. O resultado depende do áudio e da imagem que você enviou.",
          "Não prometemos que um corte terá alcance, engajamento ou resultado comercial em TikTok, Reels, Shorts ou em qualquer outra rede. A quantidade de cortes depende do plano: no teste grátis, até 10 cortes por set; nos planos pagos, até 30 cortes por set, dentro da cota de horas daquele plano.",
          "O processamento roda nos nossos servidores. Você pode fechar a aba enquanto um set está sendo processado e voltar depois para ver o resultado na sua conta, salvo se o processamento falhar.",
        ],
      },
      {
        heading: "3. Conta",
        paragraphs: [
          "Você se cadastra com nome, e-mail e senha e é responsável por informar dados verdadeiros e por manter a senha em sigilo. A conta é pessoal. Avise [E-MAIL DE CONTATO] se suspeitar de uso não autorizado.",
          "Podemos recusar, suspender ou encerrar uma conta que viole estes termos, a lei, ou que comprometa a segurança e a disponibilidade do serviço.",
        ],
      },
      {
        heading: "4. Planos, assinatura e cancelamento",
        paragraphs: [
          "O teste grátis inclui 1 hora de set no total e até 10 cortes por set, sem cartão de crédito. Não há fidelidade no teste.",
          "Os planos pagos são assinatura mensal, sem período de fidelidade, com renovação automática. O preço vigente de cada plano está na página de preços do site. O pagamento é processado pelo [GATEWAY DE PAGAMENTO], por PIX ou cartão, conforme o checkout disponível.",
          "Você pode cancelar a qualquer momento pela aba Plano do estúdio. O cancelamento interrompe a renovação e devolve a conta ao plano gratuito. Não há multa de cancelamento prevista nestes termos.",
          "Não descrevemos aqui um reembolso automático de período já pago. Pedidos de reembolso seguem o Código de Defesa do Consumidor e as regras do [GATEWAY DE PAGAMENTO]. Escreva para [E-MAIL DE CONTATO] se precisar de ajuda com uma cobrança.",
        ],
      },
      {
        heading: "5. Uso aceitável",
        paragraphs: [
          "Você não pode usar a DJviral para enviar ou gerar conteúdo ilícito, para violar direito de terceiro, para tentar acessar conta ou dado de outra pessoa, nem para sobrecarregar, sondar ou interferir nos servidores.",
          "Não use o teste grátis nem os planos para contornar a cota (por exemplo, com contas duplicadas criadas para esse fim). Podemos limitar ou encerrar o uso abusivo.",
          "O link do YouTube que você cola precisa ser um conteúdo que você tem o direito de mandar processar. Não use a DJviral para baixar ou republicar material de terceiros sem autorização.",
        ],
      },
      {
        heading: "6. Direitos autorais do conteúdo enviado",
        paragraphs: [
          "Você declara que tem os direitos necessários sobre o set que envia — arquivo ou link — inclusive fonograma, imagem e marca que apareçam nele, ou autorização de quem seja o titular, para que a DJviral processe esse material e gere os cortes.",
          "A responsabilidade pelo conteúdo enviado é sua. A DJviral não revisa previamente cada set em busca de violação de direito autoral e não assume a titularidade do seu material. Os cortes são disponibilizados para você; publicá-los continua dependendo dos direitos que você tem sobre o conteúdo.",
          "Se um titular alegar violação, podemos remover o material e suspender a conta enquanto a questão é apurada. Notificações podem ser enviadas para [E-MAIL DE CONTATO].",
        ],
      },
      {
        heading: "7. Propriedade da plataforma",
        paragraphs: [
          "A marca DJviral, a interface, o software e os modelos de análise permanecem de [RAZÃO SOCIAL] ou de seus licenciantes. Estes termos não transferem a você qualquer direito sobre a plataforma, além da licença limitada, não exclusiva e revogável de usá-la conforme o plano.",
        ],
      },
      {
        heading: "8. Limitação de responsabilidade",
        paragraphs: [
          "O serviço é oferecido no estado em que se encontra. Na extensão máxima permitida pela lei brasileira, [RAZÃO SOCIAL] não responde por lucros cessantes, perda de oportunidade, perda de audiência ou dano indireto decorrente do uso ou da indisponibilidade da DJviral, nem por falha de terceiro, incluindo a plataforma de onde um link do YouTube é obtido e o [GATEWAY DE PAGAMENTO].",
          "Nada nestes termos limita direito que o Código de Defesa do Consumidor, a LGPD ou outra norma cogente não permita limitar, inclusive em caso de dolo ou culpa grave.",
        ],
      },
      {
        heading: "9. Lei aplicável e foro",
        paragraphs: [
          "Estes termos são regidos pelas leis da República Federativa do Brasil.",
          "Fica eleito o foro da comarca de [CIDADE/FORO], com renúncia a qualquer outro, por mais privilegiado que seja. Se você for consumidor, no sentido do Código de Defesa do Consumidor, pode propor a ação no foro do seu domicílio.",
        ],
      },
      {
        heading: "10. Contato",
        paragraphs: [
          "[RAZÃO SOCIAL] · CNPJ [CNPJ] · [ENDEREÇO]",
          "[E-MAIL DE CONTATO]",
          "A Política de Privacidade está em /privacidade.",
        ],
      },
    ],
  },
  en: {
    metaTitle: "Terms of Use · DJviral",
    metaDescription:
      "DJviral account rules: monthly subscription with no lock-in, cancellation, acceptable use, and responsibility for uploaded content.",
    title: "Terms of Use",
    updated: "Last updated: November 16, 2026",
    draftNote: DRAFT_EN,
    sections: [
      {
        heading: "1. Acceptance",
        paragraphs: [
          "These Terms of Use govern access to DJviral, operated by [LEGAL NAME], CNPJ [CNPJ], address [ADDRESS]. By creating an account or using the service, you agree to these terms and to the Privacy Policy (/privacidade).",
          "If you do not agree, do not create an account and do not send content.",
        ],
      },
      {
        heading: "2. The service",
        paragraphs: [
          "DJviral receives a set as a video file or a YouTube link, analyzes the material on our servers and returns vertical clips in 9:16. The result depends on the audio and picture you sent.",
          "We do not promise that a clip will get reach, engagement or commercial results on TikTok, Reels, Shorts or any other network. How many clips you get depends on the plan: up to 10 clips per set on the free trial, and up to 30 clips per set on paid plans, within that plan's hour quota.",
          "Processing runs on our servers. You can close the tab while a set is processing and come back later to see the result in your account, unless processing fails.",
        ],
      },
      {
        heading: "3. Account",
        paragraphs: [
          "You sign up with a name, email and password. You are responsible for accurate details and for keeping the password secret. The account is personal. Write to [CONTACT EMAIL] if you suspect unauthorized use.",
          "We may refuse, suspend or close an account that breaks these terms, the law, or that threatens the security and availability of the service.",
        ],
      },
      {
        heading: "4. Plans, subscription and cancellation",
        paragraphs: [
          "The free trial includes 1 hour of set in total and up to 10 clips per set, with no credit card. The trial has no lock-in.",
          "Paid plans are a monthly subscription with no minimum term and with automatic renewal. The current price of each plan is on the pricing section of the site. Payment is processed by [PAYMENT GATEWAY], by PIX or card, according to the checkout that is available.",
          "You can cancel at any time from the Plan tab in the studio. Cancellation stops renewal and returns the account to the free plan. These terms do not provide a cancellation fee.",
          "These terms do not describe an automatic refund of a period already paid. Refund requests follow the Brazilian Consumer Defense Code and the rules of [PAYMENT GATEWAY]. Write to [CONTACT EMAIL] if you need help with a charge.",
        ],
      },
      {
        heading: "5. Acceptable use",
        paragraphs: [
          "You may not use DJviral to upload or generate illegal content, to infringe someone else's rights, to try to access another person's account or data, or to overload, probe or interfere with the servers.",
          "Do not use the free trial or the plans to get around the quota (for example with duplicate accounts created for that purpose). We may limit or end abusive use.",
          "A YouTube link you paste must be content you have the right to send for processing. Do not use DJviral to download or republish third-party material without permission.",
        ],
      },
      {
        heading: "6. Copyright in content you send",
        paragraphs: [
          "You represent that you have the rights needed in the set you send — file or link — including the recording, the image and any brand that appears in it, or permission from the owner, for DJviral to process that material and generate the clips.",
          "You are responsible for the content you send. DJviral does not pre-screen every set for copyright infringement and does not take ownership of your material. Clips are made available to you; publishing them still depends on the rights you have in the content.",
          "If a rightsholder alleges infringement, we may remove the material and suspend the account while the claim is reviewed. Notices can be sent to [CONTACT EMAIL].",
        ],
      },
      {
        heading: "7. Ownership of the platform",
        paragraphs: [
          "The DJviral brand, the interface, the software and the analysis models remain with [LEGAL NAME] or its licensors. These terms do not transfer any right in the platform to you, other than a limited, non-exclusive, revocable license to use it according to your plan.",
        ],
      },
      {
        heading: "8. Limitation of liability",
        paragraphs: [
          "The service is provided as is. To the fullest extent allowed by Brazilian law, [LEGAL NAME] is not liable for lost profits, lost opportunity, lost audience or indirect damage arising from use or unavailability of DJviral, nor for a third-party failure, including the platform a YouTube link is fetched from and [PAYMENT GATEWAY].",
          "Nothing in these terms limits a right that the Consumer Defense Code, the LGPD or another mandatory rule does not allow to be limited, including in cases of willful misconduct or gross negligence.",
        ],
      },
      {
        heading: "9. Governing law and venue",
        paragraphs: [
          "These terms are governed by the laws of the Federative Republic of Brazil.",
          "The courts of [CITY/VENUE] are elected, and any other venue is waived, however privileged it may be. If you are a consumer under the Consumer Defense Code, you may bring a claim in the courts of your domicile.",
        ],
      },
      {
        heading: "10. Contact",
        paragraphs: [
          "[LEGAL NAME] · CNPJ [CNPJ] · [ADDRESS]",
          "[CONTACT EMAIL]",
          "The Privacy Policy is at /privacidade.",
        ],
      },
    ],
  },
};
