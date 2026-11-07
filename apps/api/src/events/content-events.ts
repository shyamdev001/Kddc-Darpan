import { Global, Injectable, Module } from '@nestjs/common';
import { Subject } from 'rxjs';

/** Which screens may now need a different manifest. `all` covers media and playlist edits. */
export type ContentChange = { all: true } | { all: false; screenIds: string[] };

/**
 * A small in-process signal so media, playlists and screens can say "content changed" without
 * importing the Socket.IO gateway (which would create circular module imports).
 */
@Injectable()
export class ContentEvents {
  readonly changes = new Subject<ContentChange>();

  /** Media or a playlist changed: any screen might be affected. */
  contentChanged(): void {
    this.changes.next({ all: true });
  }

  /** A screen's own settings or assignment changed. */
  screensChanged(...screenIds: string[]): void {
    if (screenIds.length) this.changes.next({ all: false, screenIds });
  }
}

@Global()
@Module({ providers: [ContentEvents], exports: [ContentEvents] })
export class EventsModule {}
