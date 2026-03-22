Feature: Проверка регистрации через сайт и Telegram
  To verify the registration system end to end
  we automate visitor actions on the website
  and test-user actions in Telegram

  Background:
    Given the public festival website is available for testing
    And the test Telegram bot is available for testing

  @telegram_bootstrap @telethon
  Scenario: Первый пользователь Telegram становится суперадмином
    Given the bot has no admins yet
    When test Telegram user "superadmin" sends "/start"
    Then "superadmin" becomes the superadmin
    And the bot shows button navigation
    And the bot shows the help text
    When test Telegram user "second-user" sends "/start"
    Then "second-user" is not added as an admin

  @happy_path @playwright @telethon
  Scenario Outline: Посетитель успешно регистрируется на открытое событие
    Given event "<event_slug>" is open for registration
    And the Telegram superadmin chat is ready to receive notifications
    When the visitor opens the event page for "<event_slug>"
    And the visitor fills the registration form with valid full name, email and Russian phone
    And the visitor submits the registration form
    Then the visitor sees the ticket page for "<event_slug>"
    And the ticket page shows the visitor full name
    And the ticket page shows masked phone and masked email
    And the ticket page shows the event date, time, venue, hall and full address
    And the ticket page shows a 6-character ticket ID
    And the ticket page offers "Download PDF"
    And the ticket page offers Google Calendar, Apple Calendar, Android / ICS and "Download ICS"
    And the ticket page says "Printing the ticket is not required"
    And the ticket page does not offer self-service cancellation
    And the superadmin receives a Telegram notification about that registration

    Examples:
      | event_slug              |
      | scientific-library-open |
      | science-center-open     |
      | tretyakovka-open        |
      | blockhouse-open         |
      | oceania-open            |

  @validation @playwright
  Scenario Outline: Посетитель видит inline-ошибку при некорректных данных
    Given event "scientific-library-open" is open for registration
    When the visitor opens the event page for "scientific-library-open"
    And the visitor enters "<full_name>", "<email>" and "<phone>"
    And the visitor submits the registration form
    Then the registration is not created
    And the visitor sees the inline error "<error_message>"

    Examples:
      | full_name               | email                     | phone          | error_message                                                              |
      |                         | ivan@example.com          | +79991234567   | Укажите имя и фамилию полностью.                                           |
      | Иван                    | ivan@example.com          | +79991234567   | Укажите имя и фамилию полностью.                                           |
      | Иван Иванов             | invalid-email             | +79991234567   | Проверьте email: адрес выглядит некорректно.                               |
      | Иван Иванов             | temp@example-tempmail.tld | +79991234567   | Используйте постоянный email. Адреса временной почты для регистрации не подходят. |
      | Иван Иванов             | ivan@example.com          | +7123          | Введите российский номер в формате +7XXXXXXXXXX.                           |
      | <script>alert(1)</script> | ivan@example.com       | +79991234567   | Укажите имя и фамилию полностью.                                           |

  @dedupe @playwright
  Scenario: Один и тот же email или телефон нельзя использовать дважды для одного события
    Given a visitor is already registered for event "science-center-open"
    When the same visitor submits the registration form again for "science-center-open"
    Then the registration is rejected
    And the visitor sees the duplicate-registration message

  @multi_event @playwright
  Scenario: Один и тот же человек может зарегистрироваться на другое событие
    Given a visitor is already registered for event "science-center-open"
    And event "tretyakovka-open" is open for registration
    When the same visitor submits the registration form for "tretyakovka-open"
    Then the second registration is accepted
    And the visitor sees the ticket page for "tretyakovka-open"

  @past_event @playwright
  Scenario: Посетитель не может зарегистрироваться на прошедшее событие
    Given event "archive-event" is in the past
    When the visitor opens the event page for "archive-event"
    Then the page shows that the event has already passed
    When the visitor submits a direct registration request for "archive-event"
    Then the request is rejected with the past-event message

  @sold_out @playwright
  Scenario: Посетитель не может зарегистрироваться если места закончились
    Given event "blockhouse-last-seat" has no free seats
    When the visitor opens the event page for "blockhouse-last-seat"
    And the visitor submits valid registration data
    Then the registration is rejected
    And the visitor sees the sold-out message

  @race_condition @playwright @telethon
  Scenario: Только один посетитель получает последнее место
    Given event "last-seat-event" has exactly 1 free seat
    When visitor "A" and visitor "B" submit valid registration forms for that event at the same time
    Then exactly one visitor sees the ticket page
    And the other visitor sees the sold-out or retry message
    And the superadmin receives exactly one new Telegram notification for that event

  @ticket_page @playwright
  Scenario: Посетитель повторно открывает сохранённый билет и скачивает файлы
    Given a visitor is already registered for event "oceania-open"
    And the visitor has the saved ticket link
    When the visitor opens the saved ticket link
    Then the ticket page shows the same visitor and event details
    And the visitor can download the PDF
    And the visitor can download the ICS file
    And the downloaded PDF contains the same ticket ID and event details

  @telegram_help @telethon
  Scenario: Суперадмин видит help и основные кнопки
    Given the superadmin is connected to the bot
    When the superadmin sends "/help"
    Then the bot shows the list of available commands
    When the superadmin opens the main keyboard
    Then the bot shows buttons for events, search, exports, open registration, close registration, operators and help

  @telegram_find @telethon
  Scenario: Суперадмин находит регистрацию по ФИО
    Given a visitor is already registered for event "scientific-library-open"
    And the superadmin is connected to the bot
    When the superadmin searches for that visitor by full name
    Then the bot shows the matching registration with masked contacts

  @operator_permissions @telethon
  Scenario: Оператор видит отчёты, но не может менять статус регистрации
    Given the superadmin has assigned operator role to "operator-1"
    And registrations exist for event "tretyakovka-open"
    When Telegram user "operator-1" requests the report for "tretyakovka-open"
    Then the bot shows the participant list with masked email and masked phone
    And "operator-1" can download the event XLSX
    When Telegram user "operator-1" sends the open-registration command for "tretyakovka-open"
    Then the bot rejects the command

  @registration_switch @playwright @telethon
  Scenario: Суперадмин открывает и закрывает регистрацию через Telegram
    Given event "science-center-open" is closed for registration
    And the superadmin is connected to the bot
    When the superadmin sends the open-registration command for "science-center-open"
    Then the bot confirms that registration is open
    When the visitor opens the event page for "science-center-open"
    Then the registration form is available
    When the superadmin sends the close-registration command for "science-center-open"
    Then the bot confirms that registration is closed
    When the visitor opens the event page for "science-center-open" again
    Then the registration form is not available

  @telegram_outage @playwright @telethon
  Scenario: Регистрация проходит даже если Telegram временно недоступен
    Given event "scientific-library-open" is open for registration
    And Telegram delivery from the backend is temporarily unavailable
    When the visitor opens the event page for "scientific-library-open"
    And the visitor submits valid registration data
    Then the visitor still sees the ticket page
    And the superadmin does not receive the notification immediately
    When Telegram delivery is restored
    Then the superadmin eventually receives the delayed notification

  @daily_export @telethon
  Scenario: Суперадмин получает ежедневные выгрузки
    Given the superadmin is connected to the bot
    When the daily export job is triggered in the test environment
    Then the superadmin receives the combined XLSX export
    And the superadmin receives the SQLite backup

  @emergency_export
  Scenario: Суперадмин использует аварийный export если Telegram долго недоступен
    Given Telegram remains unavailable for a long period
    And the superadmin has the emergency export secret
    When the superadmin requests the emergency export endpoint
    Then the export file is returned
    And the endpoint does not allow changing registration state
    When the request is made without the correct secret
    Then the request is rejected
