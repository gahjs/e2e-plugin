# gah E2E Plugin

This plugin provides the possibility to run tests in gah with playwright. 

## Configuration

With this plugin, you can configure shared test helpers which can be used in all test modules. If no shared test helper is needed you can skip the first step. (1. Shared-test helper)

### 1. Shared-test helper

 1. Navigate to the shared gah module folder.
 2. Create a libary for shared test helper.
 3. Open a terminal in the shared module folder and execute:
```console
gah plugin add @gah/e2e-plugin
```
 4. Press enter to skip "Enter test folder Path".
 5. Enter the path to your generated libary index.ts file.

 
### 2. Module tests

 1. Navigate to the gah module folder of the module you want to write tests for.
 
You can Skip 2. if you have no shared-test files.

 2. Ensure the shared module that declares the shared test helpers is registered as a dependency in the module. (It should be, otherwise why would you need the helpers?)
 3. Open a terminal in this folder and execute:
```console
gah plugin add @gah/e2e-plugin
```
 4. Enter the path to your test folder.
 5. Press enter to skip "Enter shared-test Path".

## Installation
 1. Navigate to host folder and execute:

```console
gah install 
```
 2. Navigate to the module base folder where the test files are located and and execute:

```console
gah install 
```
You can skip 3. if you have no shared test files.

 3. Navigate to shared module folder where the shared test helpers are located and execute:

```console
gah install 
```
## Usage
To run the tests navigate to the gah host folder and execute:

```console
gah plugin run test-p <gah-modulename>
```

For CI:

```console
gah plugin run test-ci-p <gah-modulename>
```
