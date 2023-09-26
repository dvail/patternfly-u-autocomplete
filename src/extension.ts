import * as vscode from 'vscode';
import * as cssTree from 'css-tree';
import { uniqBy } from 'lodash';

import * as fs from 'fs';

type Suggestions = {
    utilities: {
        v4: vscode.CompletionItem[];
        v5: vscode.CompletionItem[];
    };
    cssVars: {
        v4: vscode.CompletionItem[];
        v5: vscode.CompletionItem[];
    };
};

const V4_UTIL_CLASS_IDENTIFIER = 'pf-u-';
const V5_UTIL_CLASS_IDENTIFIER = 'pf-v5-u-';
const V4_CSS_VAR_IDENTIFIER = '--pf-';
const V5_CSS_VAR_IDENTIFIER = '--pf-v5-';

const V4_UTIL_REGEXP = new RegExp(`${V4_UTIL_CLASS_IDENTIFIER}[\\w|-]*$`);
const V5_UTIL_REGEXP = new RegExp(`${V5_UTIL_CLASS_IDENTIFIER}[\\w|-]*$`);
const V4_CSS_VAR_REGEXP = new RegExp(`${V4_CSS_VAR_IDENTIFIER}[\\w|-]*$`);
const V5_CSS_VAR_REGEXP = new RegExp(`${V5_CSS_VAR_IDENTIFIER}[\\w|-]*$`);

const HEX_COLOR_REGEXP = /#([a-fA-F0-9]{3})|([a-fA-F0-9]{6})/;

function parseSuggestions(suggestions: Suggestions, uri: vscode.Uri): Thenable<Suggestions> {
    return vscode.workspace.openTextDocument(uri).then((document) => {
        const text = document.getText();
        const ast = cssTree.parse(text);

        cssTree.walk(ast, (node) => {
            const isUtilityV4 = node.type === 'ClassSelector' && node.name.startsWith(V4_UTIL_CLASS_IDENTIFIER);

            const isUtilityV5 = node.type === 'ClassSelector' && node.name.startsWith(V5_UTIL_CLASS_IDENTIFIER);

            const isCssVarV4 =
                node.type === 'Declaration' &&
                (node.property.startsWith(`${V4_CSS_VAR_IDENTIFIER}global`) || node.property.startsWith(`${V4_CSS_VAR_IDENTIFIER}chart`));

            const isCssVarV5 =
                node.type === 'Declaration' &&
                (node.property.startsWith(`${V5_CSS_VAR_IDENTIFIER}global`) || node.property.startsWith(`${V5_CSS_VAR_IDENTIFIER}chart`));

            if (isUtilityV4) {
                suggestions.utilities.v4.push({ label: node.name });
            } else if (isUtilityV5) {
                suggestions.utilities.v5.push({ label: node.name });
            } else if (isCssVarV4 || isCssVarV5) {
                const { property, value } = node;
                const item: vscode.CompletionItem = { label: property };

                if (value.type === 'Raw') {
                    item.detail = value.value.trim();

                    // Display color swatch for color variables
                    if (item.detail.match(HEX_COLOR_REGEXP)) {
                        item.kind = vscode.CompletionItemKind.Color;
                        item.documentation = item.detail;
                    }
                }

                const destination = isCssVarV4 ? suggestions.cssVars.v4 : suggestions.cssVars.v5;
                destination.push(item);
            }
        });

        return suggestions;
    });
}

function collectNodeModulesSuggestions(): Thenable<Suggestions> {
    // Attempt to parse PF modules from node_modules and gather utility classes
    // This will grab both v4 and v5 values if both versions are installed
    const patternflyFileFinders = [
        '**/node_modules/@patternfly/patternfly/patternfly-base.css', // Non-React PF CSS Vars
        '**/node_modules/@patternfly/patternfly/patternfly-charts.css', // Non-React PF CSS Vars (Charts)
        '**/node_modules/@patternfly/patternfly/css/utilities/**/*.css', // Non-React PF Utility Classes
        '**/node_modules/@patternfly/react-core/dist/styles/base.css', // React CSS Vars
        '**/node_modules/@patternfly/react-styles/css/utilities/**/*.css', // React Utility Classes
    ].map((pattern) => vscode.workspace.findFiles(pattern));

    return Promise.all(patternflyFileFinders).then((uriResults) => {
        const uris = uriResults.flat();
        const parsedSuggestions = {
            utilities: { v4: [], v5: [] },
            cssVars: { v4: [], v5: [] },
        };
        return Promise.all(uris.map((uri) => parseSuggestions(parsedSuggestions, uri))).then(() => {
            return parsedSuggestions;
        });
    });
}

function createUtilityCompletionProvider(context: vscode.ExtensionContext, supportedFileTypes: string[], suggestions: Suggestions) {
    const triggers = ['-'];
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        supportedFileTypes,
        {
            async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
                // IDEA - Maintain list of most frequently used completion items and show them first?

                const linePrefix = document.lineAt(position).text.slice(0, position.character);

                let completionTextStartPosition: number = -1;
                let completionPool: vscode.CompletionItem[] = [];

                // We need to check v5 matches first, since v4 matches will also match v5
                if (linePrefix.match(V5_UTIL_REGEXP)) {
                    completionTextStartPosition = linePrefix.lastIndexOf(V5_UTIL_CLASS_IDENTIFIER);
                    completionPool = suggestions.utilities.v5;
                } else if (linePrefix.match(V4_UTIL_REGEXP)) {
                    completionTextStartPosition = linePrefix.lastIndexOf(V4_UTIL_CLASS_IDENTIFIER);
                    completionPool = suggestions.utilities.v4;
                } else if (linePrefix.match(V5_CSS_VAR_REGEXP)) {
                    completionTextStartPosition = linePrefix.lastIndexOf(V5_CSS_VAR_IDENTIFIER);
                    completionPool = suggestions.cssVars.v5;
                } else if (linePrefix.match(V4_CSS_VAR_REGEXP)) {
                    completionTextStartPosition = linePrefix.lastIndexOf(V4_CSS_VAR_IDENTIFIER);
                    completionPool = suggestions.cssVars.v4;
                } else {
                    return undefined;
                }

                const range = new vscode.Range(position.line, completionTextStartPosition, position.line, position.character);

                // We're going to directly mutate the completion items to add the range here
                // for the sake of performance.
                completionPool.forEach((item) => {
                    item.range = range;
                });

                return completionPool;
            },
        },
        ...triggers,
    );

    return completionProvider;
}

function deregisterCompletionProvider(context: vscode.ExtensionContext, provider: vscode.Disposable | undefined) {
    if (provider && context.subscriptions.includes(provider)) {
        context.subscriptions.splice(context.subscriptions.indexOf(provider), 1);
        provider.dispose();
    }
}

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('PatternFly Autocomplete');

    outputChannel.appendLine('[INFO] PatternFly Autocomplete Activated');

    let completionProvider: vscode.Disposable | undefined;

    vscode.workspace.onDidChangeConfiguration(() => {
        outputChannel.appendLine('[INFO] Extension configuration has changed - reloading completion provider.');
        initializeCompletionProvider();
    });

    initializeCompletionProvider();

    function initializeCompletionProvider() {
        const configuration = vscode.workspace.getConfiguration('patternFlyAutocomplete');
        const useBundledCompletionItems = configuration.get<boolean>('useBundledCompletionItems') ?? false;
        const supportedFileTypes = configuration.get<string[]>('supportedFileTypes') ?? [];

        if (supportedFileTypes.length === 0) {
            outputChannel.appendLine(
                '[WARN] No file types configured for patternfly-autocomplete. Please add a file type to the patternFlyAutocomplete.supportedFileTypes setting.',
            );
        }

        if (useBundledCompletionItems) {
            outputChannel.appendLine(
                '[INFO] `useBundledCompletionItems` is enabled. Using bundled completion items instead of parsing installed modules.',
            );

            import('./suggestions').then((fileContents) => {
                const suggestions = fileContents.default;
                const newProvider = createUtilityCompletionProvider(context, supportedFileTypes, suggestions);
                deregisterCompletionProvider(context, completionProvider);
                completionProvider = newProvider;
                context.subscriptions.push(completionProvider);
            });
        } else {
            collectNodeModulesSuggestions().then((suggestions) => {
                // Trim out duplicate suggestions
                suggestions.cssVars.v4 = uniqBy(suggestions.cssVars.v4, 'label');
                suggestions.cssVars.v5 = uniqBy(suggestions.cssVars.v5, 'label');
                suggestions.utilities.v4 = uniqBy(suggestions.utilities.v4, 'label');
                suggestions.utilities.v5 = uniqBy(suggestions.utilities.v5, 'label');

                fs.writeFileSync('/tmp/suggestions.json', JSON.stringify(suggestions, null, 2));

                if (suggestions.cssVars.v4.length === 0 && suggestions.cssVars.v5.length === 0) {
                    outputChannel.appendLine(
                        '[WARN] No CSS variables found for completion items. Please ensure you have installed PatternFly, or set `patternFlyAutocomplete.useBundledCompletionItems` to `true`.',
                    );
                } else if (suggestions.utilities.v4.length === 0 && suggestions.utilities.v5.length === 0) {
                    outputChannel.appendLine(
                        '[WARN] No utility classes found for completion items. Please ensure you have installed PatternFly, or set `patternFlyAutocomplete.useBundledCompletionItems` to `true`.',
                    );
                }

                const newProvider = createUtilityCompletionProvider(context, supportedFileTypes, suggestions);
                deregisterCompletionProvider(context, completionProvider);
                completionProvider = newProvider;
                context.subscriptions.push(completionProvider);
            });
        }
    }
}

export function deactivate() {}
