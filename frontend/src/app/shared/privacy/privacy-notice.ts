import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-privacy-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './privacy-notice.html',
  styleUrl: '../../../../../landing/application-privacy.css',
})
export class PrivacyNotice {}
