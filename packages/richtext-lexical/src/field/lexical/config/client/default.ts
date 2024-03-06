'use client'
import type { EditorConfig as LexicalEditorConfig } from 'lexical/LexicalEditor.js'

import { LexicalEditorTheme } from '../../theme/EditorTheme.js'

export const defaultEditorLexicalConfig: LexicalEditorConfig = {
  namespace: 'lexical',
  theme: LexicalEditorTheme,
}
