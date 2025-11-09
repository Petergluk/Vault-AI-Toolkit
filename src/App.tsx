// vault-ai-toolkit/src/App.tsx
// v1.0.0 @ 2025-09-19 15:00:00

/**
 * @file App.tsx
 * @description Корневой компонент React для отображения заглушки в AI Studio.
 * @module App
 */

import React, { useState, useEffect } from 'react';

const App: React.FC = () => {
    const [history, setHistory] = useState<string>('Загрузка истории проекта...');

    useEffect(() => {
        fetch('/project_history.md')
            .then(response => {
                if (!response.ok) {
                    throw new Error('Не удалось загрузить историю проекта.');
                }
                return response.text();
            })
            .then(text => {
                setHistory(text);
            })
            .catch(error => {
                console.error('Ошибка при загрузке project_history.md:', error);
                setHistory('Не удалось загрузить историю проекта. Проверьте консоль.');
            });
    }, []);

    const styles: { [key: string]: React.CSSProperties } = {
        container: {
            padding: '20px',
            backgroundColor: '#1a1a1a',
            borderRadius: '8px',
            border: '1px solid #333',
        },
        title: {
            color: '#00aaff',
            borderBottom: '2px solid #00aaff',
            paddingBottom: '10px',
            marginBottom: '20px',
        },
        pre: {
            whiteSpace: 'pre-wrap',
            wordWrap: 'break-word',
            backgroundColor: '#111',
            padding: '15px',
            borderRadius: '4px',
            maxHeight: '70vh',
            overflowY: 'auto',
            fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
            fontSize: '14px',
            lineHeight: '1.6',
        }
    };

    return (
        <div style={styles.container}>
            <h1 style={styles.title}>Vault AI Toolkit - История Проекта</h1>
            <pre style={styles.pre}>
                {history}
            </pre>
        </div>
    );
};

export default App;
