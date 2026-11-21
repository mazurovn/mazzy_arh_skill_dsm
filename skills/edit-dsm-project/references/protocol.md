# Контракт обмена

Полный JSON хранит schema `dsm-project/1`, project и последовательность history. Запись содержит rev, parent, at, actor, note и полное data. Начальная запись имеет parent=null. В data хранятся title, nodes и edges. Симметричный ключ risk не зависит от порядка концов. Основание каждой связи хранится в reason. ID элементов можно использовать в средах с разным языком интерфейса.

Узел имеет постоянный id, name, kind (включая продукт, компонент, сервер, кластер, домен, область данных, требование, отклонение, предложение и ADR), state (unspecified, idea, planned, active, review, blocked, done), parent, release, segment, bundle, effort, capacity и note. Для пустой ссылки использовать пустую строку, для неизвестной оценки — null. Родители образуют лес. Поле release ссылается на узел вида release. Указывать capacity только у релиза. Общая единица для effort и capacity определяется командой проекта.

Патч содержит project и base из show, actor, note и непустой массив ops. Одна транзакция может добавить несколько зависимых объектов. Порядок операций сохраняется. Итог проходит проверку внешних ключей и циклов родителей.

```json
{
  "project": "<из show>",
  "base": "<из show>",
  "actor": "архитектор",
  "note": "Согласован перенос фичи во второй релиз",
  "ops": [{"op":"node","value":{"id":"F03","release":"R2"}}]
}
```

Поддерживаются node (частичное изменение или создание), edge (полная запись), title (строковое value), removeEdge (layer, from и to в value) и removeNode (id). Чтобы удалить используемый узел, явно перепривязать детей и релизы и удалить связанные рёбра в том же патче. Для источников CSV, TXT, XLSX и проекций использовать `import-preview PROJECT SOURCE [flow|risk]`, затем `import PROJECT SOURCE BASE ACTOR NOTE [flow|risk]`. Полный исходный JSON открыть напрямую.

В MCP доступны dsm_read, dsm_analyze, dsm_history, dsm_diff, dsm_preview, dsm_apply и dsm_restore. Для preview передать только project, base и ops. При apply добавить actor и note. Ошибка устаревшей базы завершает запрос без записи. Для чата без инструментов приложить актуальный JSON и попросить вернуть патч. Его можно просмотреть через «Обмен → Вставить исходный текст → JSON или патч».

Все файлы навыка кроме сторонних библиотек распространяются на условиях Mazzy Attribution License 1.0. Указание автора при переиспользовании: mazzy (mazurovn). Полный текст включён в scripts/src/LICENSE.txt.


В карточке доступны необязательные поля. `attrs` содержит словарь именованных скалярных значений. `refs` содержит ID связанных объектов. `relations` содержит пары типа и целевого ID, например `["deployedOn","S1"]`. Доступные типы — realizes, deployedOn, dependsOn, uses, owns, produces, verifies. У сценария `steps` содержит последовательность пар отправитель–получатель с существующим направленным вызовом. Массивы и словарь заменяются целиком при обновлении поля. В CSV, Excel и Markdown ячейки таких полей содержат JSON. В проекте закупок REQ-1 связывается с API, DEV-1 ссылается на затронутые объекты, а ADR-1 ссылается на предложение upgrade-memory.

## Блокноты, запросы и пакеты изменений

В примерах PROJECT.json обозначает рабочий проект. Новые файлы записываются под свободным именем.

```bash
node dsm.cjs notebook PROJECT.json review.ipynb requirements
node dsm.cjs notebook-info review.ipynb
node dsm.cjs import-preview PROJECT.json review.ipynb result
node dsm.cjs import PROJECT.json review.ipynb BASE ACTOR "Возврат расчёта" result
node dsm.cjs spec-check PROJECT.json PROPOSAL_ID
node dsm.cjs spec-export PROJECT.json PROPOSAL_ID change.zip
node dsm.cjs import-preview PROJECT.json change.zip
node dsm.cjs journey PROJECT.json REQ-1 --markdown
node dsm.cjs report PROJECT.json placement
node dsm.cjs change-log PROJECT.json FROM_REV TO_REV
```

Профили блокнотов — full, requirements, placement и readiness. Параметр result выбирает сохранённый MIME-вывод ячейки dsm-result. Без параметра импорт .ipynb читает dsm-input. Импорт чужой ревизии требует повторной сверки изменений.

Карточка request хранит проблему в note, затронутые ID в refs. В attrs находятся requester, outcome, acceptance, priority и owner. Разбор добавляет disposition, reviewer, rationale. Предложение ссылается на запрос и требования. Задача changeTask указывает ID предложения в parent и исполнителя в attrs.owner. Решение adr связывается с предложением через refs. Для инициирования запроса, подготовки предложения и Apply с автоматическим обновлением связанных статусов используйте экран «Запросы». Через stdio MCP остаются доступны чтение модели, анализ DSM, история, сравнение, предпросмотр, применение патча и восстановление.

Экспортированный ZIP содержит описание, задачи, решения и dsm-package.json с идентичностью проекта и ревизии. В том же пакете можно менять существующие документы предложения и ADR, требование с одним сценарием WHEN/THEN и флажки задач. verify-процедура для выгруженной папки — `openspec validate --all --strict`. Сторонний OpenSpec-пакет доступен для чтения в «Запросах».


Для чтения маршрута передайте в `dsm_analyze` аргумент `{"requirement":"REQ-1"}`. В ответе есть текущая стадия, запрос, предложение, решения, работы релизов, наблюдения и отклонения. CLI без `--markdown` выдаёт тот же JSON. Изменения проходят через обычные preview и apply с актуальной базой. Для наблюдения во внедрении укажите среду, фактический результат и исполнителя.

## Инсталляции и фактические узлы

Через `installation PROJECT.json ID` или `dsm_analyze {"installation":"ID"}` прочитайте типовой сервер, нагрузки, ёмкость, число узлов и состав закупки. Расчёт использует целочисленные cpuCores, ramGiB, diskGiB, replicas, spareHosts, existingHosts, необязательные antiAffinity и unitPriceRub. Сервис ссылается через deployedOn на инсталляцию, а инсталляция через uses на типовой сервер и через deployedOn на кластер. В обычной книге Excel скалярные атрибуты задаются столбцами `attr.имя`, а типизированные связи отдельными строками from / relation / to.

Блокнот `notebook PROJECT.json OUT.ipynb installation ID` строит таблицы и графики. Для приёмки заполните уникальные инвентарные номера, фактические ресурсы, среду, исполнителя и источник. Результат возвращается обычными import-preview и import с режимом result. Свидетельство привязано к исходному проекту и базе. Регистрация на проверяемой инсталляции создаёт версионные карточки OBS и, при расхождении, DEV.
