import React from 'react';
import { EditorProvider } from '@shared/editor/context/EditorContext';
import { Editor } from './components/Editor';

const App: React.FC = () => {
  return (
    <EditorProvider initialLocale={document.documentElement.lang}>
      <Editor />
    </EditorProvider>
  );
};

export default App;
