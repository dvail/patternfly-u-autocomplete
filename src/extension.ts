import * as vscode from 'vscode';
import * as csstree from 'css-tree';

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
    const utilityClasses = [...utilityClassSet];
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

                if (!linePrefix.match(/pf-u-(\w|-)*$/)) {
                    return undefined;
                }
                console.log('providing completion items', linePrefix);

                return utilityClasses.map((label) => ({
                    label,
                    range: new vscode.Range(
                        position.line,
                        document.lineAt(position).text.lastIndexOf('pf-u-'),
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
