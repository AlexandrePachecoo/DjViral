# Modelos de visão do worker

## `yolov8n.onnx` (~12 MB)

Detector de pessoas usado pela análise visual (`app/visual.py`) via `cv2.dnn`
(CPU, sem torch em runtime). É o **YOLOv8n** da ultralytics exportado para
ONNX com `imgsz=640` — entrada `images (1,3,640,640)`, saída
`output0 (1,84,8400)` (4 coords + 80 classes COCO; usamos só a classe 0,
person).

- sha256: `505648ada344cd9f3f31e51d49c489c070819bc96cc758258a8fd51488e00579`
- Origem deste arquivo: extraído do pacote npm `node-red-contrib-yolov8@0.1.0`
  (`package/lib/model/yolov8n.onnx`), que redistribui o export padrão do
  YOLOv8n. Validado com `cv2.dnn.readNetFromONNX` + inferência real antes do
  commit (pessoas detectadas com confiança ~0.9 nas imagens de teste da
  ultralytics).
- Licença do YOLOv8: AGPL-3.0 (ultralytics).

### Para re-exportar do checkpoint oficial

Se quiser regenerar o arquivo a partir da fonte oficial (recomendado ao
atualizar de versão):

```bash
pip install ultralytics
yolo export model=yolov8n.pt format=onnx imgsz=640
# gera yolov8n.onnx; copie para backend/models/
```

O worker carrega o caminho de `YOLO_MODEL_PATH` (default `models/yolov8n.onnx`,
relativo à raiz do worker). Se o arquivo estiver ausente ou corrompido, a
análise visual degrada para score de movimento e o corte dinâmico usa zoom
central — nenhum job falha por causa do modelo.

## `face_detection_yunet.onnx` (~230 KB)

Detector de ROSTO (YuNet) usado só como sinal de ANCORAGEM/centralização do
crop já escolhido pelo YOLO (`app/visual.py::detect_face_in_box`) — nunca
troca o enquadramento por um close-up de rosto, só ajusta o `y` do crop (e,
em shots já "tight"/punch-in, um pequeno bônus de zoom limitado, ver
`app/dynamic.py`). Carregado via `cv2.FaceDetectorYN_create` (nativo do
OpenCV, sem dependência extra).

- sha256: `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4`
- Origem: [`opencv/opencv_zoo`](https://github.com/opencv/opencv_zoo) —
  `models/face_detection_yunet/face_detection_yunet_2023mar.onnx`. Licença
  Apache-2.0.
- Se o arquivo estiver ausente/corrompido, a detecção de rosto degrada para
  "não encontrado" em toda janela — o enquadramento cai no comportamento
  anterior (só o box do YOLO/IA), nenhum job falha por causa do modelo.
