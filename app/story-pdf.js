const library = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/';

// 한 번에 캔버스 하나만 사용하고 PDF 순서대로 페이지 이미지를 넘겨요.
export async function renderPdfPages(data, onPage) {
  const pdfjs = await import(`${library}legacy/build/pdf.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `${library}legacy/build/pdf.worker.mjs`;
  const task = pdfjs.getDocument({
    data, cMapUrl: `${library}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${library}standard_fonts/`,
    isEvalSupported: false,
  });
  const canvas = document.createElement('canvas');
  try {
    const pdf = await task.promise;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const original = page.getViewport({ scale: 1 });
      const scale = Math.min(3, 2000 / Math.max(original.width, original.height));
      const viewport = page.getViewport({ scale });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) throw new Error('페이지를 이미지로 만들지 못했어요.');
      const name = `page-${String(number).padStart(Math.max(3, String(pdf.numPages).length), '0')}.jpg`;
      await onPage(blob, name, number, pdf.numPages);
      page.cleanup();
    }
  } finally {
    canvas.width = canvas.height = 0;
    await task.destroy();
  }
}
