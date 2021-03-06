# Задание 3

Мобилизация.Гифки – сервис для поиска гифок в перерывах между занятиями.

Сервис написан с использованием [bem-components](https://ru.bem.info/platform/libs/bem-components/5.0.0/).

Работа избранного в оффлайне реализована с помощью технологии [Service Worker](https://developer.mozilla.org/ru/docs/Web/API/Service_Worker_API/Using_Service_Workers).

Для поиска изображений используется [API сервиса Giphy](https://github.com/Giphy/GiphyAPI).

В браузерах, не поддерживающих сервис-воркеры, приложение так же должно корректно работать, 
за исключением возможности работы в оффлайне.

## Структура проекта

  * `gifs.html` – точка входа
  * `assets` – статические файлы проекта
  * `vendor` –  статические файлы внешних библиотек
  * `service-worker.js` – скрипт сервис-воркера

Открывать `gifs.html` нужно с помощью локального веб-сервера – не как файл. 
Это можно сделать с помощью встроенного в WebStorm/Idea веб-сервера, с помощью простого сервера
из состава PHP или Python. Можно воспользоваться и любым другим способом.


# Решение

### Ход мыслей

* Чтение задания;
* Ознакомление с service worker api, с особенностями инициализации, особенностями указания путей(urls);
* Состовление списка проблем патенциальных:

1. «Более надёжное кеширование на этапе fetch», после которого стало невозможно обновить HTML-страницу: у клиентов она стала браться из кеша не только в офлайн-режиме, а всегда. 
2. Перестал работать офлайн-режим: основной документ не загружался при отсутствии сети.
3. Service Worker не обрабатывает запросы из директорий assets и vendor

### Решение проблем:
Начинаем идти в обратном порядке от последних изменений, чтобы прийти к начальному состоянию и решить проблему.

````3 проблема````: Так как Service Worker обрабатывает запросы из location в своем поле видимости (scope), его нужно вынести на директорию выше из папки assets. 
Также в файле ./assets/block.js исправляем путь регистрации сервис воркера на новый: ".register('/service-worker.js')"
В файле service-worker.js исправляем путь importScripts на ``` ('./vendor/kv-keeper.js-1.0.4/kv-keeper.js') ```;

````2 проблема````: В списке файлов для кеширования небыло 'gifs.html'. Соответственно при отсутствии интернета, страница просто не загружалась.
Для исправления данной проблемы нужно добавить gipf.html в список для кеширования. 
Создаем массив filesForCache, добавляем туда файлы для кеширования.
Создаем функцию handleFilesForCache, вызываем ее на ивенте 'install'.

````1 проблема````: Данная проблема происходила, из-за того, что в коде ```.then(cacheResponse => cacheResponse || fetchAndPutToCache)```, будет возвращаться уже закешированная страница. 
Для решения данной проблемы кешируемые файлы будут записываться в cache во время ивента 'install' (см. пункт выше). Также внутри ивента 'fetch' будем использовать метод fetchWithFallbackToCache.

### Этап тестирования.

Во время тестирования было замечено следующее поведение:
1. В офлайн режиме при удалении гифки из favorite, в консоли появлялся лог о событии, но в коде service-worker.js обработчика небыло.   
Исследую проблему от removeFromFavorites в block.js, до функции handleMessage. Даннные с ивентом 'favorite:remove' попападают в функцию handleMessage, но изза отсутствия обработчика этим все заканчивалось.   
Данная проблема опасна тем, что мы будем засорять cache, т.к. при удалении из favorite, из cache данные не удаляются.   
2. При удалении, а затем добавлении гифки назад в favorite в офлайн режиме, в консоли появлялся лог об ошибке во время выполнения fetch.   
Далее проверка обработки ошибок в функции handleFavoriteAdd, ее там не оказалось.   
Данная проблема опасна тем, что если мы удалим из favorite гифку, а затем добавим назад, то в cache ее уже не будет, даже после перехода в онлайн режим. Необходимо будет ее передобавлять в favorite в онлайне.   

### Решение проблем выявленных при тестировании:
````1 проблема````: 
Создаем обработчик handleFavoriteRemove.   
Попутно выносим общую часть кода из handleFavoriteAdd в функцию urlMakerForFavoriteHandlers, чтобы не собирать копипаст в обоих хэндлерах.   
В функции handleMessage в список обработчиков добавляем ``` 'favorite:remove': handleFavoriteRemove ```   

````2 проблема````: 
Добавляем .catch на вызов fetch(url).   
Создаем массив gifsForWrite, куда пушим url, на которые вернулась ошибка.   
В ивенте 'fetch' создаем тернарный оператор, который при совпадении event.request.url с url в массиве gifsForWrite, вызывает функцию fetchAndPutToCache.   
Внутри функции fetchAndPutToCache, при удачном кешировании, удаляем url из массива gifsForWrite.   
Также необходимо добавить удаление url из массива gifsForWrite в функцию handleFavoriteRemove.   
Т.к. если в офлайн режиме удалить гифку из favorite, затем добавить (произойдет ошибка fetch(url), url попадет в массив gifsForWrite), а затем снова удалить из favorite, то мы также должны удалить данный url и из массива gifsForWrite, иначе при восстановлении онлайн режима, мы запишем гифку в cache.   

### Дополнительное задание.
Так как мы добавили запись в cache 'gifs.html' на ивенте 'install', после первого запроса уже может быть осуществлен переход в офлайн режим.

### Ответы на вопросы в service-worker.js

```
// Вопрос №1: зачем нужен этот вызов?
    .then(() => self.skipWaiting())
``` 

Вызов ````self.skipWaiting()```` нужен для того, чтобы сделать Service Worker активным. 

```

// Вопрос №2: зачем нужен этот вызов?
    self.clients.claim();

```
Вызов ````self.clients.claim()```` нужен для того, чтобы Service Worker начал констролировать клиентов в своей области видимости, без перезагрузки страницы.   
Может быть использован с ````self.skipWaiting()````, что в нашем случае и происходит, для активации и перехвата контроля новым сервис воркером.   

```

// Вопрос №3: для всех ли случаев подойдёт такое построение ключа? 
    const cacheKey = url.origin + url.pathname;

```
Нет не для всех, может произойти баг, если в event.request.url будет querystring.   
При составлении ключа мы его не учтем.   

```

 // Вопрос №4: зачем нужна эта цепочка вызовов?
            return Promise.all(
                names.filter(name => name !== CACHE_VERSION)
                    .map(name => {
                        console.log('[ServiceWorker] Deleting obsolete cache:', name);
                        return caches.delete(name);
                    })
            );

```
Данная цепочка вызовов нужна, чтобы удалить из cache, данные старых CACHE_VERSION.   
Это может понадобиться, например, если мы изменили filesToCache, изменили CACHE_VERSION, новый Service Worker будет использовать новые данные для офлайна, а старый кэш нам больше ненужен, и будет удален.   

```

// Вопрос №5: для чего нужно клонирование? 
    return cache.put(cacheKey, response.clone());

```
Response это stream. Он может быть прочитан 1 раз, для того, чтобы вернуть браузеру response, и сохранить в кэш, нам нужно сделать .clone();
На примере из сервиса гифок:
- В офлайн режиме одну и туже гифку удаляем из favorite, затем добавляем в favorite. 
- Перезагружаем страницу. 
- Восстанавливаем подключение к интернету. 
- Заходим в избранное.
Тут, если не сделан .clone(), мы не увидим гифку (с которой производили действия в офлайне), она появится только после перезагрузки страницы.
Если же сделан .clone(), то гифка запишется в cache, и сразу отобразится в favorite.