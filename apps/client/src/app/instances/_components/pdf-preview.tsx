'use client';

import {
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button, Typography } from '@mezzanine-ui/react';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '@mezzanine-ui/icons';
import { Document, Page, pdfjs } from 'react-pdf';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import styles from './pdf-preview.module.scss';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const DEFAULT_VIEWPORT_WIDTH = 760;
const MAX_PAGE_WIDTH = 920;
const MIN_PAGE_WIDTH = 320;
const PAGE_HORIZONTAL_PADDING = 32;
const MIN_SCALE = 0.75;
const MAX_SCALE = 1.75;
const SCALE_STEP = 0.25;

export interface PDFPreviewProps {
  readonly filename: string;
  readonly fileUrl: string;
  readonly onDownload?: () => void;
}

export function PDFPreview({
  filename,
  fileUrl,
  onDownload,
}: PDFPreviewProps): ReactElement {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(DEFAULT_VIEWPORT_WIDTH);

  useEffect((): (() => void) | undefined => {
    const viewport = viewportRef.current;

    if (!viewport || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver((entries): void => {
      const nextWidth = entries[0]?.contentRect.width;

      if (nextWidth) {
        setViewportWidth(nextWidth);
      }
    });

    observer.observe(viewport);

    return (): void => observer.disconnect();
  }, []);

  useEffect((): void => {
    setNumPages(null);
    setPageNumber(1);
    setScale(1);
  }, [fileUrl]);

  const pageWidth = useMemo((): number => {
    const availableWidth = Math.max(
      MIN_PAGE_WIDTH,
      viewportWidth - PAGE_HORIZONTAL_PADDING,
    );
    const baseWidth = Math.min(MAX_PAGE_WIDTH, availableWidth);

    return Math.round(baseWidth * scale);
  }, [scale, viewportWidth]);

  const loadDocument = useCallback((document: PDFDocumentProxy): void => {
    setNumPages(document.numPages);
    setPageNumber(1);
  }, []);

  const hasPreviousPage = pageNumber > 1;
  const hasNextPage = numPages !== null && pageNumber < numPages;
  const canZoomOut = scale > MIN_SCALE;
  const canZoomIn = scale < MAX_SCALE;
  const pageLabel =
    numPages === null
      ? `第 ${pageNumber} 頁`
      : `第 ${pageNumber} / ${numPages} 頁`;
  const zoomLabel = `${Math.round(scale * 100)}%`;

  return (
    <section aria-label={`${filename} PDF 預覽`} className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.pageControls} aria-label="頁面切換">
          <Button
            aria-label="上一頁"
            disabled={!hasPreviousPage}
            icon={ChevronLeftIcon}
            onClick={(): void => {
              setPageNumber((currentPageNumber) =>
                Math.max(1, currentPageNumber - 1),
              );
            }}
            size="minor"
            variant="base-secondary"
          />
          <Typography
            className={styles.counter}
            component="span"
            variant="body"
          >
            {pageLabel}
          </Typography>
          <Button
            aria-label="下一頁"
            disabled={!hasNextPage}
            icon={ChevronRightIcon}
            onClick={(): void => {
              setPageNumber((currentPageNumber) =>
                numPages === null
                  ? currentPageNumber
                  : Math.min(numPages, currentPageNumber + 1),
              );
            }}
            size="minor"
            variant="base-secondary"
          />
        </div>
        <div className={styles.zoomControls} aria-label="縮放">
          <Button
            aria-label="縮小"
            disabled={!canZoomOut}
            icon={ZoomOutIcon}
            onClick={(): void => {
              setScale((currentScale) =>
                Math.max(MIN_SCALE, currentScale - SCALE_STEP),
              );
            }}
            size="minor"
            variant="base-secondary"
          />
          <Typography
            className={styles.counter}
            component="span"
            variant="body"
          >
            {zoomLabel}
          </Typography>
          <Button
            aria-label="放大"
            disabled={!canZoomIn}
            icon={ZoomInIcon}
            onClick={(): void => {
              setScale((currentScale) =>
                Math.min(MAX_SCALE, currentScale + SCALE_STEP),
              );
            }}
            size="minor"
            variant="base-secondary"
          />
        </div>
        {onDownload ? (
          <Button
            icon={DownloadIcon}
            iconType="leading"
            onClick={onDownload}
            size="minor"
            variant="base-primary"
          >
            下載
          </Button>
        ) : null}
      </div>
      <div className={styles.viewport} ref={viewportRef}>
        <Document
          error={<PDFPreviewState message="PDF 無法載入。" />}
          file={fileUrl}
          loading={<PDFPreviewState message="正在載入 PDF..." />}
          noData={<PDFPreviewState message="沒有可預覽的 PDF。" />}
          onLoadSuccess={loadDocument}
        >
          <Page
            className={styles.page}
            loading={<PDFPreviewState message="正在載入頁面..." />}
            pageNumber={pageNumber}
            renderAnnotationLayer
            renderTextLayer
            width={pageWidth}
          />
        </Document>
      </div>
    </section>
  );
}

function PDFPreviewState({
  message,
}: {
  readonly message: string;
}): ReactElement {
  return (
    <div className={styles.state}>
      <Typography color="text-neutral" variant="body">
        {message}
      </Typography>
    </div>
  );
}
