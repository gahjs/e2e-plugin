# gah E2E Plugin

This plugin provides the possibility to run tests in gah with playwright and ava. 

## Configuration

The plugin provides the possibility to configure a shared-test helper which can be used in all test modules. If no shared-test helper is needed you can skip the step 1. Shared-test helper.

### 1. Shared-test helper

 1. Navigate to shared gah module folder.
 2. Create a libary for shared test helper.
 3. Open cmd in folder and run:
```console
gah plugin add @gah/e2e-plugin
```
 4. Press enter key to skip "Enter test folder Path".
 5. Enter the path to your generated libary index.ts file.

 
### 2. Module test

 1. Navigate to gah module folder in which tests should be created.<br>
You can Skip 2. if you have no shared-test files.<br>
 2. Make sure that the shared module where the shared test files are located is registered as a dependency in the module. If not add it as dependency.
 3. Open cmd in folder and run:
```console
gah plugin add @gah/e2e-plugin
```
 4. Enter the path to your test folder.
 5. Press enter key to skip "Enter shared-test Path".

## Installation
To exect
 1. Navigate to host folder and open a cmd.

```console
gah install 
```
 2. Navigate to the module base folder where the test files located and open a cmd.

```console
gah install 
```
You can skip 3. if you have no shared-test files.<br>
 3. Navigate to shared module folder where the shared-test helper located and open a cmd.

```console
gah install 
```
## Usage
To run the tests navigate to the gah host folder and run a cmd.

```console
gah plugin run test <gah-modulename>
```
