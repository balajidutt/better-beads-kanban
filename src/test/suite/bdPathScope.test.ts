import * as assert from 'assert';
import cp from 'child_process';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { DaemonBeadsAdapter } from '../../daemonBeadsAdapter';

suite('beadsKanban.bdPath is read for the repository folder', () => {
  const root = '/workspace/folder-a';
  let spawn: sinon.SinonStub;
  let folderValue: string;
  let unscopedValue: string;

  setup(() => {
    folderValue = '';
    unscopedValue = '';
    spawn = sinon.stub(cp, 'spawn').callsFake(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: sinon.spy() });
      setImmediate(() => child.emit('close', 0));
      return child as any;
    });
    sinon.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string, scope?: vscode.ConfigurationScope | null) => {
      const forRoot = scope instanceof vscode.Uri && scope.fsPath === vscode.Uri.file(root).fsPath;
      return {
        get: (key: string, fallback?: unknown) => {
          if (section !== 'beadsKanban' || key !== 'bdPath') { return fallback; }
          return (forRoot && folderValue) || unscopedValue || fallback;
        }
      } as unknown as vscode.WorkspaceConfiguration;
    });
  });

  teardown(() => sinon.restore());

  const adapter = () => new DaemonBeadsAdapter(root, { appendLine: () => undefined } as unknown as vscode.OutputChannel);

  test('a folder-level bdPath is the executable for that folder', async () => {
    folderValue = '/folder/bin/bd';
    unscopedValue = '/user/bin/bd';
    const subject = adapter();
    await (subject as any).execBd(['list', '--json']);
    assert.strictEqual(spawn.firstCall.args[0], '/folder/bin/bd');
    assert.strictEqual(subject.getBdExecutable(), '/folder/bin/bd');
  });

  test('without a folder value the user or workspace bdPath is used', async () => {
    unscopedValue = '/user/bin/bd';
    await (adapter() as any).execBd(['list', '--json']);
    assert.strictEqual(spawn.firstCall.args[0], '/user/bin/bd');
  });

  test('with no bdPath anywhere bd is found on PATH', async () => {
    await (adapter() as any).execBd(['list', '--json']);
    assert.strictEqual(spawn.firstCall.args[0], 'bd');
  });
});
