import { ChangeDetectionStrategy, Component } from '@angular/core';

import { AppShell } from './layout/app-shell/app-shell';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppShell],
  template: '<app-shell />',
  styles: `
    :host {
      display: block;
      height: 100%;
    }
  `,
})
export class App {}
