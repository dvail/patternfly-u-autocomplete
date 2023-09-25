import * as vscode from 'vscode';
import * as csstree from 'css-tree';

type CompletionType = 'UTILITY_CLASS_V4' | 'UTILITY_CLASS_V5' | 'CSS_VARIABLE' | 'NONE';

function parseUtilityClasses(accumulatedSet: Set<string>, uri: vscode.Uri): Thenable<Set<string>> {
    return vscode.workspace.openTextDocument(uri).then((document) => {
        let text = document.getText();
        const ast = csstree.parse(text);

        csstree.walk(ast, (node) => {
            if (
                node.type === 'ClassSelector' &&
                (node.name.startsWith('pf-u-') || node.name.startsWith('pf-v5-u-'))
            ) {
                accumulatedSet.add(node.name);
            }
        });

        return accumulatedSet;
    });
}

function registerUtilityCompletionProvider(
    context: vscode.ExtensionContext,
    utilityClassSet: Set<string>,
) {
    const utilityClassesV4 = [...utilityClassSet];
    const utilityClassesV5 = [...utilityClassSet].map((className) =>
        className.replace('pf-u-', 'pf-v5-u-'),
    );
    const cssVariables = ['--pf-v5-global--link--Color'];

    const triggers = ['-'];
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        ['html', 'typescriptreact', 'typescript', 'javascript', 'javascriptreact'],
        {
            async provideCompletionItems(
                document: vscode.TextDocument,
                position: vscode.Position,
                token: vscode.CancellationToken,
                context: vscode.CompletionContext,
            ) {
                // For utility classes
                // - Restrict to "string" context
                // - Restrict to "pf-u-" prefix or "pf-v5-u-" prefix

                // For CSS variables
                // - Restrict to "--pf-" or "--pf-v5-" prefix

                // IDEA - Show inline colors in completion window?
                // IDEA - Maintain list of most frequently used completion items and show them first?

                const linePrefix = document.lineAt(position).text.slice(0, position.character);
                console.log('providing completion items', linePrefix);

                let completionType: CompletionType = 'NONE';

                if (linePrefix.match(/pf-u-(\w|-)*$/)) {
                    completionType = 'UTILITY_CLASS_V4';
                } else if (linePrefix.match(/pf-v5-u-(\w|-)*$/)) {
                    completionType = 'UTILITY_CLASS_V5';
                } else if (linePrefix.match(/--pf-(\w|-)*$/)) {
                    completionType = 'CSS_VARIABLE';
                } else {
                    return undefined;
                }

                const completionTextStartPosition = (() => {
                    if (completionType === 'UTILITY_CLASS_V4') {
                        return linePrefix.lastIndexOf('pf-u-');
                    } else if (completionType === 'UTILITY_CLASS_V5') {
                        return linePrefix.lastIndexOf('pf-v5-u-');
                    }
                    return linePrefix.lastIndexOf('--pf-');
                })();

                const completionPool = (() => {
                    if (completionType === 'UTILITY_CLASS_V4') {
                        return utilityClassesV4;
                    } else if (completionType === 'UTILITY_CLASS_V5') {
                        return utilityClassesV5;
                    }
                    return cssVariables;
                })();

                return completionPool.map((label) => ({
                    label,
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

    // TODO Check non-react style files too
    vscode.workspace
        .findFiles('**/node_modules/@patternfly/react-styles/css/utilities/**/*.css')
        .then((uris) => {
            const cssUtilityClassSet = new Set<string>();
            return Promise.all(
                uris.map((uri) => parseUtilityClasses(cssUtilityClassSet, uri)),
            ).then(() => {
                return cssUtilityClassSet;
            });
        })
        .then((classes) => {
            registerUtilityCompletionProvider(context, classes);
        });
}

export function deactivate() {}
