import * as vscode from 'vscode';
import * as cssTree from 'css-tree';

type Suggestions = {
    utilities: vscode.CompletionItem[];
    cssVars: vscode.CompletionItem[];
};

const V4_UTIL_CLASS_IDENTIFIER = 'pf-u-';
const V5_UTIL_CLASS_IDENTIFIER = 'pf-v5-u-';
const V4_CSS_VAR_IDENTIFIER = '--pf-';
const V5_CSS_VAR_IDENTIFIER = '--pf-v5-';

const V4_UTIL_REGEXP = new RegExp(`${V4_UTIL_CLASS_IDENTIFIER}[\\w|-]*$`);
const V5_UTIL_REGEXP = new RegExp(`${V5_UTIL_CLASS_IDENTIFIER}[\\w|-]*$`);
const V4_CSS_VAR_REGEXP = new RegExp(`${V4_CSS_VAR_IDENTIFIER}[\\w|-]*$`);
const V5_CSS_VAR_REGEXP = new RegExp(`${V5_CSS_VAR_IDENTIFIER}[\\w|-]*$`);

function parseUtilityClasses(suggestionSets: Suggestions, uri: vscode.Uri): Thenable<Suggestions> {
    console.log(`Parsing ${uri}`);
    return vscode.workspace.openTextDocument(uri).then((document) => {
        const text = document.getText();
        const ast = cssTree.parse(text);

        cssTree.walk(ast, (node) => {
            const isUtility =
                node.type === 'ClassSelector' &&
                (node.name.startsWith(V4_UTIL_CLASS_IDENTIFIER) ||
                    node.name.startsWith(V5_UTIL_CLASS_IDENTIFIER));

            const isCssVar =
                node.type === 'Declaration' &&
                (node.property.startsWith(`${V5_CSS_VAR_IDENTIFIER}global`) ||
                    node.property.startsWith(`${V5_CSS_VAR_IDENTIFIER}chart`) ||
                    node.property.startsWith(`${V4_CSS_VAR_IDENTIFIER}global`) ||
                    node.property.startsWith(`${V4_CSS_VAR_IDENTIFIER}chart`));

            if (isUtility) {
                suggestionSets.utilities.push({ label: node.name });
            } else if (isCssVar) {
                const { property, value } = node;
                const item: vscode.CompletionItem = { label: property };

                if (value.type === 'Raw' && value.value.trim().match(/#[a-fA-F0-9]{6}/)) {
                    item.kind = vscode.CompletionItemKind.Color;
                    item.documentation = value.value.trim();
                }

                suggestionSets.cssVars.push(item);
            }
        });

        return suggestionSets;
    });
}

function registerUtilityCompletionProvider(
    context: vscode.ExtensionContext,
    suggestionSets: Suggestions,
) {
    const utilityClasses = [...suggestionSets.utilities];
    const cssVariables = [...suggestionSets.cssVars];

    const triggers = ['-'];
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        ['html', 'typescriptreact', 'typescript', 'javascript', 'javascriptreact'],
        {
            async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
                // IDEA - Maintain list of most frequently used completion items and show them first?

                const linePrefix = document.lineAt(position).text.slice(0, position.character);

                let completionTextStartPosition: number = -1;
                let completionPool: vscode.CompletionItem[] = [];

                if (linePrefix.match(V4_UTIL_REGEXP)) {
                    completionTextStartPosition = linePrefix.lastIndexOf(V4_UTIL_CLASS_IDENTIFIER);
                    completionPool = utilityClasses;
                } else if (linePrefix.match(V5_UTIL_REGEXP)) {
                    completionTextStartPosition = linePrefix.lastIndexOf(V5_UTIL_CLASS_IDENTIFIER);
                    completionPool = utilityClasses;
                } else if (linePrefix.match(V4_CSS_VAR_REGEXP)) {
                    completionTextStartPosition = linePrefix.lastIndexOf(V4_CSS_VAR_IDENTIFIER);
                    completionPool = cssVariables;
                } else if (linePrefix.match(V5_CSS_VAR_REGEXP)) {
                    completionTextStartPosition = linePrefix.lastIndexOf(V5_CSS_VAR_IDENTIFIER);
                    completionPool = cssVariables;
                } else {
                    return undefined;
                }

                return completionPool.map(({ ...properties }) => ({
                    ...properties,
                    range: new vscode.Range(
                        position.line,
                        completionTextStartPosition,
                        position.line,
                        position.character,
                    ),
                }));
            },
        },
        ...triggers,
    );

    context.subscriptions.push(completionProvider);
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "patternfly-u-autocomplete" is now active!');

    // Attempt to parse PF modules from node_modules and gather utility classes

    const patternflyFileFinders = [
        '**/node_modules/@patternfly/patternfly/patternfly-base.css', // Plain PF CSS Vars
        '**/node_modules/@patternfly/patternfly/patternfly-charts.css', // Plain PF CSS Vars (Charts)
        '**/node_modules/@patternfly/patternfly/css/utilities/**/*.css', // Plain PF Utility Classes
        '**/node_modules/@patternfly/react-core/dist/styles/base.css', // React CSS Vars
        '**/node_modules/@patternfly/react-styles/css/utilities/**/*.css', // React Utility Classes
    ].map((pattern) => vscode.workspace.findFiles(pattern));

    Promise.all(patternflyFileFinders)
        .then((uriResults) => {
            const uris = uriResults.flat();
            const parsedSuggestionSets = {
                utilities: [],
                cssVars: [],
            };
            return Promise.all(
                uris.map((uri) => parseUtilityClasses(parsedSuggestionSets, uri)),
            ).then(() => {
                return parsedSuggestionSets;
            });
        })
        .then((results) => {
            registerUtilityCompletionProvider(context, results);
        });
}

export function deactivate() {}
