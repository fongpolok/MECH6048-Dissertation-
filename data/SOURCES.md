# RAG Corpus Sources

Provenance list for every PDF in `data/`, used by the RAG ingest pipeline
(`src/ingest.py`) to build `chroma_db/`. All documents are publicly
downloadable materials from official Hong Kong government / health-authority
sources.

## Original corpus

| File | Source URL | Description |
|---|---|---|
| `hkrf_diabetes.pdf` | Hong Kong Reference Framework for Diabetes Care for Adults in Primary Care Settings (Health Bureau / Primary Care Office, healthbureau.gov.hk) | Full clinical reference framework for diabetes care — detailed guidance for healthcare professionals. |
| `hkrf_ht.pdf` | Hong Kong Reference Framework for Hypertension Care for Adults in Primary Care Settings (Health Bureau / Primary Care Office, healthbureau.gov.hk) | Full clinical reference framework for hypertension care — detailed guidance for healthcare professionals. |
| `operation_manual_cdcc_fd.pdf` | Chronic Disease Co-Care (CDCC) Scheme / Family Doctor operation manual (Health Bureau, healthbureau.gov.hk) | Operational manual describing the CDCC primary-care scheme workflow for hypertension/diabetes management. |

## Added to improve `grounded_fact` numeric-target retrieval (2026-07-17)

| File | Source URL | Description |
|---|---|---|
| `hkrf_diabetes_patient.pdf` | https://www.healthbureau.gov.hk/phcc/rfs/src/pdfviewer/web/pdf/educationalresources/tc/01_tc_c_diabetes_care_patient.pdf | 《香港糖尿病參考概覽 - 成年糖尿病患者在基層醫療的護理【病友篇】》— patient-facing companion to the diabetes reference framework, with concise diagnostic glucose thresholds (fasting ≥7.0 mmol/L, 2h postprandial ≥11.1 mmol/L), HbA1c targets, and diabetic foot-care guidance in plain language. |
| `hkrf_ht_patient.pdf` | https://www.healthbureau.gov.hk/phcc/rfs/src/pdfviewer/web/pdf/educationalresources/tc/05_tc_c_hypertension_care_patient.pdf | 《香港高血壓參考概覽 - 成年高血壓患者在基層醫療的護理【病友篇】》— patient-facing companion to the hypertension reference framework, stating BP classification table and target BP (<140/90 mmHg general; <130/80 mmHg with comorbid diabetes/chronic disease). |
| `primary_care_settings_summary.pdf` | https://www.healthbureau.gov.hk/phcc/files/primary_care_settings.pdf | 《成年糖尿病及高血壓患者之基層醫療護理》— a combined, condensed patient guide covering both conditions in one document; contains explicit tables/statements for BP targets (140/90 general, 130/80 with diabetes) and glucose diagnostic ranges (normal fasting <6.1 mmol/L, diabetes ≥7.0 mmol/L, HbA1c ≥6.5%). Chosen specifically because it states the exact numeric targets asked about in the eval set in short, directly-quotable sentences, which should be easier for the embedding retriever to surface than the longer full clinical reference frameworks. |
| `ehs_diabetic_foot_care.pdf` | https://www.elderly.gov.hk/tc_chi/newsletter/vol64/files/EHS%20newsletter-Issue64_Web.pdf | Department of Health Elderly Health Service newsletter (Issue 64, Nov 2023), lead article 《糖尿病患者的足部護理》(diabetic foot care) by a nursing officer — practical daily foot-inspection/care advice for elderly diabetic patients, targeted at the same population as the app. |
| `ehs_diabetic_dietary_guidelines.pdf` | https://www.elderly.gov.hk/tc_chi/education_and_media_resources/files/ham/book_dietary_guidelines.pdf | Department of Health Elderly Health Service 《糖尿病患者飲食須知》(dietary guidelines for diabetic patients) — official patient booklet on diet/carbohydrate management for elderly diabetics, complementing the clinical guidance already in the corpus. |

## Added by the user (2026-07-23)

| File | Source | Description |
|---|---|---|
| `hku_prediabetes_article.pdf` | 《Explore the World of Medicine》Vol. V, Sept 2018, HKU LKS Faculty of Medicine — article 《糖尿病前期你要知》, transcribed from a talk by Dr. Esther Yee Tak Yu (余懿德醫生), Clinical Assistant Professor, Department of Family Medicine and Primary Care, HKU | Prediabetes diagnosis and management: WHO/ADA diagnostic thresholds for prediabetes vs. diabetes across all three test methods (fasting glucose 6.1–6.9 mmol/L / HbA1c 5.7–6.4% / OGTT 7.8–11.0 mmol/L for prediabetes; ≥7.0 / ≥6.5% / ≥11.1 for diabetes), a pros/cons comparison table of the three test methods, risk factors, reversibility, and exercise/diet targets (150 min/week moderate exercise, waist circumference ≤90cm men / ≤80cm women). This is a **scanned PDF with no text layer** — see "OCR fallback" below. |

### OCR fallback for scanned PDFs

`hku_prediabetes_article.pdf` has no extractable text layer (PyPDFLoader
returns empty content per page). `src/text_processor.py` detects this
automatically and OCRs each page with the local vision model
(`OCR_VISION_MODEL`, `qwen2.5vl:7b` by default) instead of silently
contributing zero chunks. The transcription is cached in
`hku_prediabetes_article.pdf.ocr.txt` (committed alongside the PDF) so
re-running `python -m src.ingest` — or the test suite — never needs
Ollama/network after the first OCR pass. Delete the `.ocr.txt` sidecar to
force a re-transcription (e.g. after switching to a different/better vision
model).
