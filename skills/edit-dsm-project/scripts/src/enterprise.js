/* A fictional deployment and procurement decision for the onboarding template. */
const Enterprise = ((M)=>({
  model(title='Архитектура поставок') {
    return M.validate({title,nodes:[
      {id:'ORG',kind:'organization',name:'Дирекция снабжения',note:'Учебная организация. Названия и показатели синтетические.'},
      {id:'SUPPLY',kind:'domain',name:'Закупки',parent:'ORG'},
      {id:'DATA',kind:'dataArea',name:'Данные поставщиков',parent:'SUPPLY'},
      {id:'BUY',kind:'project',name:'Электронная заявка',parent:'ORG'},
      {id:'LOT',kind:'procurement',name:'Закупка вычислительных ресурсов',parent:'BUY',attrs:{owner:'Отдел снабжения'},refs:['INSTALL']},
      {id:'INSTALL',kind:'installation',name:'Промышленная установка',parent:'BUY'},
      {id:'POOL',kind:'cluster',name:'Кластер закупок',parent:'INSTALL'},
      {id:'S1',kind:'server',name:'Основной сервер',parent:'POOL',attrs:{memoryGiB:16}},
      {id:'PORTAL',kind:'product',name:'Портал закупок',parent:'SUPPLY'},
      {id:'API',kind:'component',name:'Сервис заявок',parent:'PORTAL',relations:[['deployedOn','S1'],['realizes','REQ-1']]},
      {id:'STORE',kind:'component',name:'Реестр поставщиков',parent:'PORTAL',relations:[['uses','DATA']]},
      {id:'REL',kind:'release',name:'Пилот',parent:'BUY',capacity:8},
      {id:'F1',kind:'feature',name:'Проверка заявки',release:'REL',effort:3,parent:'API'},
      {id:'REQ-1',kind:'requirement',name:'Хранение реестра на сервере с резервом',note:'обеспечивать минимум 32 ГиБ памяти на основном сервере.',attrs:{when:'сервис вводится в эксплуатацию',then:'паспорт сервера показывает минимум 32 ГиБ'},parent:'BUY'},
      {id:'DEV-1',kind:'deviation',name:'Недостаточный объём памяти',refs:['S1','API','REQ-1'],attrs:{expected:'32 ГиБ',actual:'16 ГиБ'},state:'review'},
      {id:'upgrade-memory',kind:'proposal',name:'Увеличить память сервера',state:'review',refs:['REQ-1','DEV-1','S1'],note:'## Why\n\nСерверу пилота требуется резерв памяти.\n\n## What Changes\n\nУвеличить память до 32 ГиБ и закрыть отклонение после проверки.\n\n## Capabilities\n\n### New Capabilities\n\n- Сервер с резервом для сервиса заявок.\n\n## Impact\n\nПилотная установка портала закупок.'},
      {id:'ADR-1',kind:'adr',name:'Расширение существующего узла',state:'done',refs:['upgrade-memory','S1','LOT'],note:'## Контекст\n\nПилот размещён на S1.\n\n## Решение\n\nСогласовать поставку памяти в действующий сервер.\n\n## Последствия\n\nТребуется окно обслуживания.'},
      {id:'SC-1',kind:'scenario',name:'Проверка поставщика',steps:[['PORTAL','API'],['API','STORE']],refs:['REQ-1']}
    ],edges:[
      {layer:'flow',from:'PORTAL',to:'API',weight:1,reason:'Передать заявку на проверку'},
      {layer:'flow',from:'API',to:'STORE',weight:2,reason:'Проверить статус поставщика'},
      {layer:'risk',from:'API',to:'STORE',weight:3,reason:'Версия карточки поставщика совпадает с версией в заявке'}
    ]});
  }
}))(typeof DSM!=='undefined'?DSM:require('./model.js'));
if(typeof module!=='undefined')module.exports=Enterprise;
