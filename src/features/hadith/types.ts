export interface HadithGrade {
  readonly grade: string;
  readonly gradedBy?: string;
}

export interface HadithText {
  readonly urn?: number;
  readonly language: "ar" | "en";
  readonly direction: "rtl" | "ltr";
  readonly chapterNumber?: string;
  readonly chapterTitle?: string;
  readonly body: string;
  readonly grades: readonly HadithGrade[];
}

export interface HadithRecord {
  readonly id: string;
  readonly collection: string;
  readonly name: string;
  readonly bookNumber?: string;
  readonly chapterId?: string;
  readonly hadithNumber: string;
  readonly texts: readonly HadithText[];
  readonly provenance: {
    readonly provider: string;
    readonly sourceUrl: string;
    readonly termsUrl?: string;
    readonly license: string;
    readonly attribution: string;
  };
}

export interface HadithPage {
  readonly verseKey: string;
  readonly records: readonly HadithRecord[];
  readonly page: number;
  readonly hasMore: boolean;
  readonly truncated?: boolean;
  readonly source: "local" | "quran-foundation";
}
