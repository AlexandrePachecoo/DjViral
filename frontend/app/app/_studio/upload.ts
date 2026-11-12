// Upload do vídeo do set direto do navegador para o Supabase Storage.
//
// Caminho principal: upload RESUMÁVEL (protocolo TUS). O arquivo vai em
// pedaços de 6 MB; se a conexão cair no meio, o cliente pergunta ao servidor
// até onde ele recebeu e continua dali, em vez de recomeçar um set de vários
// GB do zero (o que o PUT único fazia).
//
// Reserva: se o servidor recusar a CRIAÇÃO do upload resumável (antes de
// qualquer byte ser aceito), cai no PUT único na signed URL — o comportamento
// antigo. Depois que o upload resumável começou, um erro é erro: não
// recomeçamos GBs por outro caminho.

import * as tus from "tus-js-client";

export type UploadTarget = {
  // PUT único (reserva).
  signedUrl: string;
  // Upload resumável: endpoint TUS do Storage + token da signed upload URL
  // (vai no header `x-signature`) + destino do objeto.
  tusEndpoint?: string;
  token?: string;
  bucket?: string;
  storagePath?: string;
};

// O Storage do Supabase exige pedaços de exatamente 6 MB no TUS.
const CHUNK_SIZE = 6 * 1024 * 1024;

// Esperas entre tentativas de um pedaço que falhou. A lista é reiniciada a
// cada pedaço enviado com sucesso, então isso cobre ~4 min de conexão fora do
// ar POR QUEDA, não no upload inteiro.
const RETRY_DELAYS = [0, 2000, 5000, 10000, 20000, 30000, 60000, 120000];

type ErrorText = { status: (status: number, detail: string) => string; network: string };

function putUpload(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
  text: ErrorText
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type || "video/mp4");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(text.status(xhr.status, xhr.responseText)));
    };
    xhr.onerror = () => reject(new Error(text.network));
    xhr.send(file);
  });
}

// Erro do upload resumável, marcando se algum byte chegou a ser aceito.
class ResumableError extends Error {
  constructor(
    message: string,
    readonly started: boolean
  ) {
    super(message);
  }
}

function resumableUpload(
  target: Required<UploadTarget>,
  file: File,
  onProgress: (percent: number) => void,
  text: ErrorText
): Promise<void> {
  return new Promise((resolve, reject) => {
    let started = false;
    let best = 0;
    const upload = new tus.Upload(file, {
      endpoint: target.tusEndpoint,
      chunkSize: CHUNK_SIZE,
      retryDelays: RETRY_DELAYS,
      headers: { "x-signature": target.token },
      metadata: {
        bucketName: target.bucket,
        objectName: target.storagePath,
        contentType: file.type || "video/mp4",
      },
      uploadDataDuringCreation: true,
      // Cada set cria um projeto (e um caminho) novo, então não há upload
      // anterior do mesmo arquivo para retomar entre visitas — a retomada que
      // importa é a de quedas de conexão durante ESTE envio.
      storeFingerprintForResuming: false,
      removeFingerprintOnSuccess: true,
      // Numa retomada o cliente volta a contar do ponto confirmado pelo
      // servidor; a barra não recua por causa disso.
      onProgress: (sent, total) => {
        if (total <= 0) return;
        best = Math.max(best, Math.round((sent / total) * 100));
        onProgress(best);
      },
      onChunkComplete: () => {
        started = true;
      },
      onError: (err) => {
        const res = (err as tus.DetailedError).originalResponse;
        const message = res
          ? text.status(res.getStatus(), res.getBody() ?? "")
          : text.network;
        reject(new ResumableError(message, started));
      },
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}

export async function uploadSource(
  target: UploadTarget,
  file: File,
  onProgress: (percent: number) => void,
  text: ErrorText
): Promise<void> {
  const { tusEndpoint, token, bucket, storagePath } = target;
  if (tusEndpoint && token && bucket && storagePath) {
    try {
      await resumableUpload(
        { signedUrl: target.signedUrl, tusEndpoint, token, bucket, storagePath },
        file,
        onProgress,
        text
      );
      return;
    } catch (err) {
      if (!(err instanceof ResumableError) || err.started) throw err;
      console.warn("Upload resumável recusado, usando upload simples:", err.message);
      onProgress(0);
    }
  }
  await putUpload(target.signedUrl, file, onProgress, text);
}
