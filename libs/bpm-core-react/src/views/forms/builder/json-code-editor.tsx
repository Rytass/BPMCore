'use client';

import { CSSProperties, ReactElement } from 'react';
import dynamic from 'next/dynamic';
import { json } from '@codemirror/lang-json';
import { EditorView } from '@codemirror/view';
import type { Extension, ReactCodeMirrorProps } from '@uiw/react-codemirror';

const EDITOR_FALLBACK_STYLE: CSSProperties = {
  alignItems: 'center',
  border: '1px solid var(--mzn-color-border-neutral)',
  borderRadius: 4,
  color: 'var(--mzn-color-text-neutral)',
  display: 'flex',
  minHeight: 160,
  padding: 12,
  width: '100%',
};

const JSON_EDITOR_EXTENSIONS: readonly Extension[] = [
  json(),
  EditorView.lineWrapping,
  EditorView.theme({
    '&': {
      border: '1px solid var(--mzn-color-border-neutral)',
      borderRadius: '4px',
      fontSize: '13px',
      width: '100%',
    },
    '&.cm-focused': {
      outline: '1px solid var(--mzn-color-border-primary)',
    },
    '.cm-content': {
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      minHeight: '100%',
    },
    '.cm-editor': {
      width: '100%',
    },
    '.cm-gutters': {
      borderRight: '1px solid var(--mzn-color-border-neutral)',
    },
    '.cm-scroller': {
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    },
  }),
];

const CodeMirror = dynamic<ReactCodeMirrorProps>(
  () => import('@uiw/react-codemirror'),
  {
    loading: (): ReactElement => (
      <div style={EDITOR_FALLBACK_STYLE}>載入 JSON 編輯器</div>
    ),
    ssr: false,
  },
);

interface JsonCodeEditorProps {
  readonly disabled?: boolean;
  readonly height: string;
  readonly name: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly value: string;
}

export function JsonCodeEditor({
  disabled = false,
  height,
  name,
  onChange,
  placeholder,
  value,
}: JsonCodeEditorProps): ReactElement {
  return (
    <CodeMirror
      aria-label={name}
      basicSetup={{
        autocompletion: true,
        bracketMatching: true,
        closeBrackets: true,
        defaultKeymap: true,
        foldGutter: true,
        highlightActiveLine: true,
        highlightSelectionMatches: true,
        lineNumbers: true,
        syntaxHighlighting: true,
      }}
      editable={!disabled}
      extensions={[...JSON_EDITOR_EXTENSIONS]}
      height={height}
      indentWithTab={false}
      onChange={onChange}
      placeholder={placeholder}
      readOnly={disabled}
      theme="light"
      value={value}
      width="100%"
    />
  );
}
